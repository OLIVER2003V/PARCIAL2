<#
.SYNOPSIS
    Pruebas automatizadas para CU21 - Asistente de Formulario (Voz / Texto / Archivo).

.DESCRIPTION
    El script realiza las siguientes acciones en orden:
      1. Autentica como admin y obtiene un JWT.
      2. Siembra procesos de demo  (POST /api/admin/seed-demo).
      3. Siembra tramites de prueba (POST /api/admin/seed-tramites).
      4. Ejecuta 5 casos de prueba contra POST /api/ia/voz-formulario (modo texto).
      5. Compara los campos extraidos por la IA contra los valores esperados.
      6. Muestra una tabla pass/fail por campo y un puntaje global.
      7. Limpia los datos de prueba si se pasa -Limpiar.

.PARAMETER BaseUrl
    URL base de la API REST.  Defecto: http://localhost:8080/api

.PARAMETER Usuario
    Nombre de usuario administrador. Defecto: admin

.PARAMETER Password
    Contrasenia del administrador. Defecto: admin123

.PARAMETER SoloTests
    Omite la siembra (asume que los datos ya existen) y ejecuta solo los tests.

.PARAMETER Limpiar
    Elimina los tramites y procesos de prueba al finalizar.

.EXAMPLE
    .\test-cu21.ps1

.EXAMPLE
    .\test-cu21.ps1 -BaseUrl "http://13.59.124.116:8080/api" -Usuario "admin" -Password "miPass" -Limpiar

.EXAMPLE
    .\test-cu21.ps1 -SoloTests
#>

# Script de pruebas local — la contrasenia viaja solo a localhost:8080
[Diagnostics.CodeAnalysis.SuppressMessageAttribute(
    'PSAvoidUsingPlainTextForPassword', 'Password',
    Justification = 'Script de pruebas local, no se expone en produccion')]
param(
    [string]$BaseUrl  = "http://localhost:8080/api",
    [string]$Usuario  = "admin_real",
    [string]$Password = "SuperPassword123",
    [switch]$SoloTests,
    [switch]$Limpiar
)

$ErrorActionPreference = "Stop"
$ProgressPreference    = "SilentlyContinue"

# ==============================================================================
#  HELPERS DE CONSOLA
# ==============================================================================

function Write-Pass  { param($msg) Write-Host "    [OK] $msg" -ForegroundColor Green }
function Write-Fail  { param($msg) Write-Host "    [--] $msg" -ForegroundColor Red }
function Write-Warn  { param($msg) Write-Host "    [!]  $msg" -ForegroundColor Yellow }
function Write-Info  { param($msg) Write-Host "    [i]  $msg" -ForegroundColor Cyan }

function Write-Step {
    param($msg)
    Write-Host ""
    Write-Host "  --- $msg" -ForegroundColor Magenta
}

function Write-Title {
    param($msg)
    $line = "=" * 66
    Write-Host ""
    Write-Host "  $line" -ForegroundColor White
    Write-Host "    $msg" -ForegroundColor White
    Write-Host "  $line" -ForegroundColor White
}

function Write-SubTitle {
    param($msg)
    Write-Host ""
    Write-Host "  >> $msg" -ForegroundColor Cyan
}

# ==============================================================================
#  AUTENTICACION Y LLAMADAS HTTP
# ==============================================================================

$script:JwtToken = $null

function Login {
    Write-Info "Autenticando como '$Usuario' en $BaseUrl ..."
    try {
        $cuerpo = '{"username":"' + $Usuario + '","password":"' + $Password + '"}'
        $resp   = Invoke-RestMethod -Uri "$BaseUrl/auth/login" `
                      -Method Post -ContentType "application/json" -Body $cuerpo
        $script:JwtToken = $resp.token
        Write-Pass "JWT obtenido correctamente."
    }
    catch {
        # Intentar leer el cuerpo de la respuesta para mejor diagnostico
        $statusCode = $null
        $bodyText   = $null
        try {
            $statusCode = $_.Exception.Response.StatusCode.value__
            $stream     = $_.Exception.Response.GetResponseStream()
            $reader     = [System.IO.StreamReader]::new($stream)
            $bodyText   = $reader.ReadToEnd()
            $reader.Close()
        } catch {}

        Write-Host ""
        Write-Host "  [ERROR FATAL] Fallo la autenticacion (HTTP $statusCode)" -ForegroundColor Red

        if ($statusCode -eq 403) {
            Write-Host ""
            Write-Host "  Causa probable segun HTTP 403:" -ForegroundColor Yellow
            Write-Host "    a) La cuenta '$Usuario' existe pero esta DESHABILITADA en la BD." -ForegroundColor Yellow
            Write-Host "       Solucion: En MongoDB, pon activo:true y enabled:true en el documento del usuario." -ForegroundColor Yellow
            Write-Host "    b) La contrasenia es incorrecta (a veces Spring devuelve 403 en lugar de 401)." -ForegroundColor Yellow
            Write-Host "       Solucion: Ejecuta el script pasando tus credenciales reales:" -ForegroundColor Yellow
            Write-Host "         .\test-cu21.ps1 -Usuario `"tuUsuario`" -Password `"tuContrasenia`"" -ForegroundColor Cyan
        } elseif ($statusCode -eq 401) {
            Write-Host "  Credenciales incorrectas. Pasa -Usuario y -Password correctos." -ForegroundColor Yellow
        } elseif ($statusCode -eq 0 -or $null -eq $statusCode) {
            Write-Host "  No se pudo conectar al servidor. Verifica que el backend este corriendo en:" -ForegroundColor Yellow
            Write-Host "    $BaseUrl" -ForegroundColor Cyan
            Write-Host "  Si usas otro puerto o IP, pasa -BaseUrl:" -ForegroundColor Yellow
            Write-Host "    .\test-cu21.ps1 -BaseUrl `"http://localhost:8080/api`"" -ForegroundColor Cyan
        }

        if ($bodyText -and $bodyText.Trim().Length -gt 0) {
            Write-Host ""
            Write-Host "  Respuesta del servidor: $bodyText" -ForegroundColor DarkGray
        }

        Write-Host ""
        exit 1
    }
}

function Invoke-Api {
    param([string]$Method, [string]$Path, $Body = $null)
    $headers = @{ Authorization = "Bearer $script:JwtToken" }
    $uri     = "$BaseUrl$Path"
    try {
        if ($null -ne $Body) {
            return Invoke-RestMethod -Uri $uri -Method $Method -Headers $headers `
                -ContentType "application/json" -Body ($Body | ConvertTo-Json -Depth 10)
        }
        return Invoke-RestMethod -Uri $uri -Method $Method -Headers $headers
    }
    catch {
        $code = $null
        try { $code = $_.Exception.Response.StatusCode.value__ } catch {}
        Write-Warn "HTTP $code en $Method $Path -- $($_.Exception.Message)"
        return $null
    }
}

# Construye y envia multipart/form-data (campos + texto) al endpoint de IA
function Invoke-VozFormulario {
    param(
        [string]$Texto,
        [string]$CamposJson
    )

    $boundary = [System.Guid]::NewGuid().ToString("N")
    $encoding = [System.Text.Encoding]::UTF8
    $stream   = [System.IO.MemoryStream]::new()
    $writer   = [System.IO.StreamWriter]::new($stream, $encoding)
    $nl       = "`r`n"

    # Parte: campos
    $writer.Write("--$boundary$nl")
    $writer.Write("Content-Disposition: form-data; name=`"campos`"$nl")
    $writer.Write("Content-Type: text/plain; charset=utf-8$nl")
    $writer.Write("$nl")
    $writer.Write($CamposJson)
    $writer.Write("$nl")

    # Parte: texto
    $writer.Write("--$boundary$nl")
    $writer.Write("Content-Disposition: form-data; name=`"texto`"$nl")
    $writer.Write("Content-Type: text/plain; charset=utf-8$nl")
    $writer.Write("$nl")
    $writer.Write($Texto)
    $writer.Write("$nl")

    $writer.Write("--$boundary--$nl")
    $writer.Flush()
    $bodyBytes = $stream.ToArray()
    $writer.Close()
    $stream.Close()

    $headers = @{
        "Authorization" = "Bearer $script:JwtToken"
        "Content-Type"  = "multipart/form-data; boundary=$boundary"
    }

    try {
        return Invoke-RestMethod -Uri "$BaseUrl/ia/voz-formulario" `
               -Method Post -Headers $headers -Body $bodyBytes
    }
    catch {
        $errorBody = $null
        try { $errorBody = $_.ErrorDetails.Message | ConvertFrom-Json } catch {}
        return [PSCustomObject]@{
            exito            = $false
            errorMsg         = $_.Exception.Message
            errorBody        = $errorBody
            camposLlenados   = [PSCustomObject]@{}
            confianza        = 0
            camposDetectados = 0
            transcript       = ""
        }
    }
}

# ==============================================================================
#  COMPARACION FUZZY
#  Tolera variaciones menores de formato (mayusculas, espacios, parafraseos).
# ==============================================================================

function Test-Valor {
    param($Actual, [string]$Esperado, [string]$Tipo)

    if ($null -eq $Actual -or ([string]$Actual).Trim() -eq "") { return $false }

    switch ($Tipo) {

        "numero" {
            $a = 0.0; $e = 0.0
            $aOk = [double]::TryParse([string]$Actual,
                [System.Globalization.NumberStyles]::Any,
                [System.Globalization.CultureInfo]::InvariantCulture, [ref]$a)
            $eOk = [double]::TryParse([string]$Esperado,
                [System.Globalization.NumberStyles]::Any,
                [System.Globalization.CultureInfo]::InvariantCulture, [ref]$e)
            if ($aOk -and $eOk) { return [Math]::Abs($a - $e) -le 0.01 }
            return $false
        }

        "telefono" {
            $a = [regex]::Replace([string]$Actual,   '\D', '')
            $e = [regex]::Replace([string]$Esperado, '\D', '')
            if ($a.Length -ge $e.Length) { return $a.EndsWith($e) }
            return $e.EndsWith($a)
        }

        "email" {
            return ([string]$Actual).Trim().ToLower() -eq $Esperado.Trim().ToLower()
        }

        "fecha" {
            return ([string]$Actual).Trim() -eq $Esperado.Trim()
        }

        default {
            $a = ([string]$Actual).ToLower().Trim()
            $e = $Esperado.ToLower().Trim()

            if ($a -eq $e)       { return $true }
            if ($a.Contains($e)) { return $true }
            if ($e.Contains($a)) { return $true }

            # Similitud de palabras (Jaccard >= 60%)
            $wa    = ($a -split '[^a-z0-9]+') | Where-Object { $_.Length -gt 2 }
            $we    = ($e -split '[^a-z0-9]+') | Where-Object { $_.Length -gt 2 }
            $inter = ($wa | Where-Object { $we -contains $_ }).Count
            $union = (@($wa) + @($we) | Select-Object -Unique).Count
            if ($union -gt 0 -and ($inter / $union) -ge 0.60) { return $true }

            return $false
        }
    }
}

# ==============================================================================
#  SCHEMAS DE CAMPOS
#  Mismo formato que VozNlpService.construirSchemaJSON().
#  Se excluyen campos tipo: archivo, imagen, firma, titulo, subtitulo,
#  parrafo, separador, documento-texto, documento-hoja, ubicacion (tipo GPS).
# ==============================================================================

$SCHEMA_LIC001 = '[{"id":"nombre_negocio","etiqueta":"Nombre del establecimiento","tipo":"texto","requerido":true},{"id":"tipo_actividad","etiqueta":"Tipo de actividad comercial","tipo":"texto","requerido":true},{"id":"direccion","etiqueta":"Direccion exacta del local","tipo":"texto","requerido":true},{"id":"propietario","etiqueta":"Nombre del propietario o representante","tipo":"texto","requerido":true},{"id":"dpi_nit","etiqueta":"DPI o NIT del propietario","tipo":"texto","requerido":true},{"id":"telefono","etiqueta":"Telefono de contacto","tipo":"telefono","requerido":true},{"id":"email","etiqueta":"Correo electronico","tipo":"email","requerido":false},{"id":"num_empleados","etiqueta":"Numero de empleados","tipo":"numero","requerido":true},{"id":"area_m2","etiqueta":"Area del local en m2","tipo":"numero","requerido":true},{"id":"horario","etiqueta":"Horario de atencion al publico","tipo":"texto","requerido":true}]'

$SCHEMA_SOC002 = '[{"id":"nombre_estudiante","etiqueta":"Nombre completo del estudiante","tipo":"texto","requerido":true},{"id":"fecha_nacimiento","etiqueta":"Fecha de nacimiento del estudiante","tipo":"fecha","requerido":true},{"id":"nombre_tutor","etiqueta":"Nombre del padre, madre o tutor","tipo":"texto","requerido":true},{"id":"dpi_tutor","etiqueta":"DPI del tutor","tipo":"texto","requerido":true},{"id":"telefono","etiqueta":"Telefono de contacto","tipo":"telefono","requerido":true},{"id":"centro_educativo","etiqueta":"Centro educativo donde estudia","tipo":"texto","requerido":true},{"id":"grado","etiqueta":"Grado o anio que cursa","tipo":"texto","requerido":true},{"id":"ingresos_familia","etiqueta":"Ingresos familiares mensuales aproximados","tipo":"numero","requerido":true},{"id":"num_dependientes","etiqueta":"Numero de personas que dependen del ingreso","tipo":"numero","requerido":true}]'

$SCHEMA_CON001 = '[{"id":"propietario","etiqueta":"Nombre del propietario del terreno","tipo":"texto","requerido":true},{"id":"dpi_propietario","etiqueta":"DPI del propietario","tipo":"texto","requerido":true},{"id":"ubicacion","etiqueta":"Direccion exacta del predio","tipo":"texto","requerido":true},{"id":"area_m2","etiqueta":"Area total a construir en m2","tipo":"numero","requerido":true},{"id":"niveles","etiqueta":"Numero de niveles o pisos","tipo":"numero","requerido":true},{"id":"uso_edificacion","etiqueta":"Uso de la edificacion","tipo":"texto","requerido":true},{"id":"profesional","etiqueta":"Nombre del arquitecto o ingeniero responsable","tipo":"texto","requerido":true},{"id":"num_colegiado","etiqueta":"Numero de colegiatura del profesional","tipo":"texto","requerido":true}]'

$SCHEMA_SAL001 = '[{"id":"nombre_local","etiqueta":"Nombre del establecimiento","tipo":"texto","requerido":true},{"id":"tipo_local","etiqueta":"Tipo de establecimiento","tipo":"texto","requerido":true},{"id":"propietario","etiqueta":"Nombre del propietario","tipo":"texto","requerido":true},{"id":"dpi","etiqueta":"DPI del propietario","tipo":"texto","requerido":true},{"id":"direccion","etiqueta":"Direccion del establecimiento","tipo":"texto","requerido":true},{"id":"num_manipuladores","etiqueta":"Numero de manipuladores de alimentos","tipo":"numero","requerido":true},{"id":"tipo_alimentos","etiqueta":"Tipo de alimentos que se preparan o venden","tipo":"texto","requerido":true}]'

$SCHEMA_EMP001 = '[{"id":"razon_social","etiqueta":"Nombre o razon social de la empresa","tipo":"texto","requerido":true},{"id":"tipo_empresa","etiqueta":"Tipo de empresa (S.A., persona natural...)","tipo":"texto","requerido":true},{"id":"actividad","etiqueta":"Actividad economica principal","tipo":"texto","requerido":true},{"id":"nit","etiqueta":"NIT de la empresa","tipo":"texto","requerido":true},{"id":"representante","etiqueta":"Nombre del representante legal","tipo":"texto","requerido":true},{"id":"dpi_repres","etiqueta":"DPI del representante legal","tipo":"texto","requerido":true},{"id":"domicilio_fiscal","etiqueta":"Domicilio fiscal","tipo":"texto","requerido":true},{"id":"telefono","etiqueta":"Telefono de la empresa","tipo":"telefono","requerido":true},{"id":"email","etiqueta":"Correo electronico de contacto","tipo":"email","requerido":true}]'

# ==============================================================================
#  PROMPTS  (definidos como variables para evitar limitaciones de here-strings)
# ==============================================================================

$PROMPT_LIC001 = "El negocio se llama Ferreteria El Constructor. " +
    "Se dedica a la venta de ferreteria y materiales de construccion. " +
    "Esta ubicado en la 5a Avenida 12-34 zona 3. " +
    "El propietario es Carlos Antonio Lopez Rodriguez, DPI 1234567890101, " +
    "telefono 55551234, correo carlos@constructor.com. " +
    "Tiene 8 empleados. El area del local es 120 metros cuadrados. " +
    "Atiende de lunes a sabado de 8:00 a 18:00."

$PROMPT_SOC002 = "Lucia Fernanda Acabal Xiloj nacio el 3 de noviembre de 2009. " +
    "La tutora es Maria Elena Xiloj Gutierrez, DPI 2345678901234, telefono 44442222. " +
    "Estudia en el Instituto Nacional de Educacion Basica Aldea Pamanzana, cursando segundo basico. " +
    "Los ingresos familiares son de 2500 quetzales al mes y en la familia son 5 personas."

$PROMPT_CON001 = "El propietario del terreno es Roberto Alejandro Salazar Morales, DPI 3456789012345. " +
    "El predio esta en la 3era Calle 8-15, Colonia Santa Elena, zona 6. " +
    "Se construira una casa de 180 metros cuadrados, dos niveles, para uso residencial. " +
    "La arquitecta responsable es Patricia Morales Cifuentes, numero de colegiatura ARQ-14592."

$PROMPT_SAL001 = "El restaurante se llama El Sabor de Casa. " +
    "Es un comedor y restaurante tipico guatemalteco. " +
    "El propietario es Juana Isabel Tol Cac, DPI 4567890123456. " +
    "Esta ubicado en la 2da Calle Final, Barrio San Jose. " +
    "Cuentan con 4 manipuladores de alimentos. " +
    "Se preparan y venden comida tipica guatemalteca, antojitos y desayunos."

$PROMPT_EMP001 = "La empresa se llama Tech Solutions Sociedad Anonima, constituida como Sociedad Anonima. " +
    "Se dedica al desarrollo de software y consultoria tecnologica. NIT: 5678901-2. " +
    "El representante legal es Miguel Fernando Cruz Herrera, DPI 5678901234567. " +
    "Domicilio fiscal en Torre Empresarial Zona 10, Oficina 805. " +
    "Telefono de contacto 23332444, correo info@techsolutions.gt."

# ==============================================================================
#  CASOS DE PRUEBA
# ==============================================================================

$Tests = @(

    # TEST 1: LIC001 - Licencia de Funcionamiento - todos los campos vacios
    [ordered]@{
        Nombre  = "CU21-P1 / LIC001 - Licencia de Funcionamiento"
        Schema  = $SCHEMA_LIC001
        Prompt  = $PROMPT_LIC001
        Esperado = [ordered]@{
            nombre_negocio = [ordered]@{ valor = "Ferreteria El Constructor";               tipo = "texto" }
            tipo_actividad = [ordered]@{ valor = "ferreteria y materiales de construccion"; tipo = "texto" }
            direccion      = [ordered]@{ valor = "5a Avenida 12-34 zona 3";                 tipo = "texto" }
            propietario    = [ordered]@{ valor = "Carlos Antonio Lopez Rodriguez";          tipo = "texto" }
            dpi_nit        = [ordered]@{ valor = "1234567890101";                           tipo = "texto" }
            telefono       = [ordered]@{ valor = "55551234";                                tipo = "telefono" }
            email          = [ordered]@{ valor = "carlos@constructor.com";                  tipo = "email" }
            num_empleados  = [ordered]@{ valor = "8";                                       tipo = "numero" }
            area_m2        = [ordered]@{ valor = "120";                                     tipo = "numero" }
            horario        = [ordered]@{ valor = "lunes a sabado 8:00 a 18:00";             tipo = "texto" }
        }
    },

    # TEST 2: SOC002 - Beca Escolar - campos parcialmente prellenados
    [ordered]@{
        Nombre  = "CU21-P2 / SOC002 - Beca Escolar (partial)"
        Schema  = $SCHEMA_SOC002
        Prompt  = $PROMPT_SOC002
        Esperado = [ordered]@{
            nombre_estudiante = [ordered]@{ valor = "Lucia Fernanda Acabal Xiloj";                           tipo = "texto" }
            fecha_nacimiento  = [ordered]@{ valor = "2009-11-03";                                            tipo = "fecha" }
            nombre_tutor      = [ordered]@{ valor = "Maria Elena Xiloj Gutierrez";                           tipo = "texto" }
            dpi_tutor         = [ordered]@{ valor = "2345678901234";                                         tipo = "texto" }
            telefono          = [ordered]@{ valor = "44442222";                                              tipo = "telefono" }
            centro_educativo  = [ordered]@{ valor = "Instituto Nacional de Educacion Basica Aldea Pamanzana"; tipo = "texto" }
            grado             = [ordered]@{ valor = "segundo basico";                                        tipo = "texto" }
            ingresos_familia  = [ordered]@{ valor = "2500";                                                  tipo = "numero" }
            num_dependientes  = [ordered]@{ valor = "5";                                                     tipo = "numero" }
        }
    },

    # TEST 3: CON001 - Permiso de Construccion - todos los campos vacios
    [ordered]@{
        Nombre  = "CU21-P3 / CON001 - Permiso de Construccion"
        Schema  = $SCHEMA_CON001
        Prompt  = $PROMPT_CON001
        Esperado = [ordered]@{
            propietario     = [ordered]@{ valor = "Roberto Alejandro Salazar Morales";       tipo = "texto" }
            dpi_propietario = [ordered]@{ valor = "3456789012345";                           tipo = "texto" }
            ubicacion       = [ordered]@{ valor = "3era Calle 8-15, Colonia Santa Elena, zona 6"; tipo = "texto" }
            area_m2         = [ordered]@{ valor = "180";                                     tipo = "numero" }
            niveles         = [ordered]@{ valor = "2";                                       tipo = "numero" }
            uso_edificacion = [ordered]@{ valor = "residencial";                             tipo = "texto" }
            profesional     = [ordered]@{ valor = "Patricia Morales Cifuentes";              tipo = "texto" }
            num_colegiado   = [ordered]@{ valor = "ARQ-14592";                               tipo = "texto" }
        }
    },

    # TEST 4: SAL001 - Permiso Sanitario - todos los campos vacios
    [ordered]@{
        Nombre  = "CU21-P4 / SAL001 - Permiso Sanitario para Alimentos"
        Schema  = $SCHEMA_SAL001
        Prompt  = $PROMPT_SAL001
        Esperado = [ordered]@{
            nombre_local      = [ordered]@{ valor = "El Sabor de Casa";                             tipo = "texto" }
            tipo_local        = [ordered]@{ valor = "comedor restaurante tipico guatemalteco";       tipo = "texto" }
            propietario       = [ordered]@{ valor = "Juana Isabel Tol Cac";                         tipo = "texto" }
            dpi               = [ordered]@{ valor = "4567890123456";                                tipo = "texto" }
            direccion         = [ordered]@{ valor = "2da Calle Final, Barrio San Jose";             tipo = "texto" }
            num_manipuladores = [ordered]@{ valor = "4";                                            tipo = "numero" }
            tipo_alimentos    = [ordered]@{ valor = "comida tipica guatemalteca antojitos desayunos"; tipo = "texto" }
        }
    },

    # TEST 5: EMP001 - Registro de Empresa - todos los campos vacios
    [ordered]@{
        Nombre  = "CU21-P5 / EMP001 - Registro de Empresa"
        Schema  = $SCHEMA_EMP001
        Prompt  = $PROMPT_EMP001
        Esperado = [ordered]@{
            razon_social     = [ordered]@{ valor = "Tech Solutions Sociedad Anonima";                    tipo = "texto" }
            tipo_empresa     = [ordered]@{ valor = "Sociedad Anonima";                                   tipo = "texto" }
            actividad        = [ordered]@{ valor = "desarrollo de software consultoria tecnologica";     tipo = "texto" }
            nit              = [ordered]@{ valor = "5678901-2";                                          tipo = "texto" }
            representante    = [ordered]@{ valor = "Miguel Fernando Cruz Herrera";                       tipo = "texto" }
            dpi_repres       = [ordered]@{ valor = "5678901234567";                                      tipo = "texto" }
            domicilio_fiscal = [ordered]@{ valor = "Torre Empresarial Zona 10, Oficina 805";             tipo = "texto" }
            telefono         = [ordered]@{ valor = "23332444";                                           tipo = "telefono" }
            email            = [ordered]@{ valor = "info@techsolutions.gt";                              tipo = "email" }
        }
    }
)

# ==============================================================================
#  EJECUCION PRINCIPAL
# ==============================================================================

Write-Title "CU21 -- Pruebas Automatizadas del Asistente de Formulario"
Write-Info "URL base : $BaseUrl"
Write-Info "Usuario  : $Usuario"
Write-Info "SoloTests: $($SoloTests.IsPresent)"
Write-Info "Limpiar  : $($Limpiar.IsPresent)"
Write-Info "Tests    : $($Tests.Count) casos"

# --- PASO 1: Autenticacion ---
Write-Step "PASO 1 / Autenticacion"
Login

# --- PASO 2-3: Siembra ---
if (-not $SoloTests) {
    Write-Step "PASO 2 / Sembrar procesos de demo"
    $r = Invoke-Api -Method Post -Path "/admin/seed-demo"
    if ($null -ne $r) {
        Write-Pass $r.mensaje
    } else {
        Write-Warn "No se pudo sembrar los procesos de demo (pueden ya existir)."
    }

    Write-Step "PASO 3 / Sembrar tramites de prueba CU21"
    $r = Invoke-Api -Method Post -Path "/admin/seed-tramites"
    if ($null -ne $r) {
        Write-Pass $r.mensaje
        Write-Info "Funcionario asignado: $($r.funcionarioAsignado)"
        Write-Host ""
        Write-Info "Para verificar en la app:"
        if ($null -ne $r.instrucciones) {
            foreach ($instruccion in $r.instrucciones) {
                Write-Host "      $instruccion" -ForegroundColor DarkGray
            }
        }
    } else {
        Write-Warn "No se pudo sembrar los tramites de prueba."
    }
} else {
    Write-Info "Modo -SoloTests activo: saltando siembra."
}

# --- PASO 4: Casos de prueba ---
Write-Step "PASO 4 / Ejecutando casos de prueba (modo texto)"

$totalCampos      = 0
$totalPasados     = 0
$resultadosPorTest = @()

foreach ($test in $Tests) {

    Write-SubTitle $test.Nombre

    # Llamada al backend
    $inicio = Get-Date
    $resp   = Invoke-VozFormulario -Texto $test.Prompt -CamposJson $test.Schema
    $ms     = [int](((Get-Date) - $inicio).TotalMilliseconds)

    # Error de red o IA caida
    if (-not $resp.exito -and $resp.errorMsg -and $resp.errorMsg.Length -gt 0) {
        Write-Fail "Error al llamar al backend: $($resp.errorMsg)"
        if ($null -ne $resp.errorBody) {
            Write-Warn "Resp. servidor: $($resp.errorBody | ConvertTo-Json -Depth 3)"
        }
        $resultadosPorTest += [ordered]@{
            Nombre    = $test.Nombre
            Pasados   = 0
            Total     = $test.Esperado.Count
            Pct       = 0
            Ms        = $ms
            Confianza = 0
        }
        continue
    }

    # Metadatos de la respuesta
    $confVal = $resp.confianza
    if ($null -eq $confVal) { $confVal = 0 }
    $conf   = [int]([double]$confVal * 100)

    $detVal = $resp.camposDetectados
    if ($null -eq $detVal) { $detVal = 0 }

    $campos = $resp.camposLlenados

    if ($null -ne $resp.transcript -and $resp.transcript.Length -gt 0) {
        $preview = $resp.transcript
        if ($preview.Length -gt 90) { $preview = $preview.Substring(0, 87) + "..." }
        Write-Host "    [>] Texto recibido: `"$preview`"" -ForegroundColor DarkGray
    }
    Write-Host "    [~] Confianza: $conf%  Detectados: $detVal/$($test.Esperado.Count)  Tiempo: ${ms}ms" `
        -ForegroundColor DarkGray

    # Comparar campo por campo
    $pasadosEnTest = 0
    $totalEnTest   = $test.Esperado.Count

    foreach ($id in $test.Esperado.Keys) {
        $info    = $test.Esperado[$id]
        $valorIA = $null
        try { $valorIA = $campos.PSObject.Properties[$id].Value } catch {}

        $ok = Test-Valor -Actual $valorIA -Esperado $info.valor -Tipo $info.tipo

        $totalCampos++
        if ($ok) {
            $totalPasados++
            $pasadosEnTest++
            $display = if ($null -eq $valorIA) { "(null)" } else { [string]$valorIA }
            Write-Pass ("{0,-24}  IA: `"{1}`"" -f $id, $display)
        } else {
            $display = if ($null -eq $valorIA -or ([string]$valorIA).Trim() -eq "") { "(vacio)" } else { [string]$valorIA }
            Write-Fail ("{0,-24}  IA: `"{1}`"  Esp: `"{2}`"" -f $id, $display, $info.valor)
        }
    }

    $pct = 0
    if ($totalEnTest -gt 0) { $pct = [int](($pasadosEnTest / $totalEnTest) * 100) }
    $colorPct = "Red"
    if ($pct -ge 95) { $colorPct = "Green" } elseif ($pct -ge 80) { $colorPct = "Yellow" }

    Write-Host ("    [-] Score: {0}/{1} campos correctos  ({2}%)" -f $pasadosEnTest, $totalEnTest, $pct) `
        -ForegroundColor $colorPct

    $resultadosPorTest += [ordered]@{
        Nombre    = $test.Nombre
        Pasados   = $pasadosEnTest
        Total     = $totalEnTest
        Pct       = $pct
        Ms        = $ms
        Confianza = $conf
    }
}

# ==============================================================================
#  TABLA RESUMEN
# ==============================================================================

Write-Title "RESUMEN DE RESULTADOS"

$anchoNombre = 50
Write-Host ("  {0,-$anchoNombre}  {1,5}  {2,9}  {3,6}  {4}" -f `
    "Caso de prueba", "Score", "Confianza", "Tiempo", "Barra") -ForegroundColor White
Write-Host ("  " + "-" * 82) -ForegroundColor DarkGray

foreach ($r in $resultadosPorTest) {
    $barLen  = [int]($r.Pct / 5)
    $bar     = ("#" * $barLen).PadRight(20)
    $color   = "Red"
    if ($r.Pct -ge 95) { $color = "Green" } elseif ($r.Pct -ge 80) { $color = "Yellow" }

    $nombre  = $r.Nombre
    if ($nombre.Length -gt $anchoNombre) { $nombre = $nombre.Substring(0, $anchoNombre - 1) + "~" }

    Write-Host ("  {0,-$anchoNombre}  {1,3}%   {2,6}%   {3,5}ms  [{4}]" -f `
        $nombre, $r.Pct, $r.Confianza, $r.Ms, $bar) -ForegroundColor $color
}

# Puntaje global
$pctGlobal = 0
if ($totalCampos -gt 0) { $pctGlobal = [int](($totalPasados / $totalCampos) * 100) }

$colorGlobal = "Red"
if ($pctGlobal -ge 95) { $colorGlobal = "Green" } elseif ($pctGlobal -ge 80) { $colorGlobal = "Yellow" }

Write-Host ""
Write-Host ("  " + "=" * 66) -ForegroundColor White
Write-Host ("  PUNTAJE GLOBAL: {0}%   ({1} / {2} campos correctos)" -f `
    $pctGlobal, $totalPasados, $totalCampos) -ForegroundColor $colorGlobal
Write-Host ("  " + "=" * 66) -ForegroundColor White

# Veredicto
Write-Host ""
if ($pctGlobal -ge 95) {
    Write-Host "  [APROBADO] CU21 cumple el objetivo de precision >= 95%." -ForegroundColor Green
} elseif ($pctGlobal -ge 80) {
    Write-Host "  [PARCIAL]  Precision entre 80-94%. Ajustar el prompt en GeminiAiService." -ForegroundColor Yellow
    Write-Host "             Revisar campos que fallaron repetidamente." -ForegroundColor Yellow
} else {
    Write-Host "  [REPROBADO] Precision < 80%. Revisar endpoint /api/ia/voz-formulario y el prompt NLP." -ForegroundColor Red
}

# --- PASO 5: Limpieza (opcional) ---
if ($Limpiar) {
    Write-Step "PASO 5 / Limpiando datos de prueba"

    $r = Invoke-Api -Method Delete -Path "/admin/seed-tramites"
    if ($null -ne $r) { Write-Pass $r.mensaje } else { Write-Warn "No habia tramites de prueba para eliminar." }

    $r2 = Invoke-Api -Method Delete -Path "/admin/seed-demo"
    if ($null -ne $r2) { Write-Pass $r2.mensaje } else { Write-Warn "No habia procesos de demo para eliminar." }
}

Write-Host ""
