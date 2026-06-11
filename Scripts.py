import win32com.client
import json
import os

def ejecutar_superscript(archivo_json='diagrama.json'):
    print(f"Cargando plano desde: {archivo_json}...")

    if not os.path.exists(archivo_json):
        print(f"ERROR: No se encontró el archivo {archivo_json}.")
        return
    
    with open(archivo_json, 'r', encoding='utf-8') as f:
        datos = json.load(f)
        
    config_diag = datos.get("configuracion", {})
    tipo_diagrama = config_diag.get("tipo", "Logical")
    nombre_diagrama = config_diag.get("nombre", "Diagrama Generado")

    # ==========================================================
    # MOTOR PLANTUML (Exclusivo para Diagramas de Tiempo)
    # ==========================================================
    if tipo_diagrama.lower() == "timing":
        print("\nDetectado Diagrama de Tiempo.")
        print("Generando archivo PlantUML...")
        
        # ELIMINAMOS el 'hide time-axis' y agregamos un título de escala
        lineas_puml = [
            "@startuml", 
            "scale 1.5",
            f"caption Escala de tiempo en milisegundos (ms) - {nombre_diagrama}"
        ]
        
        lineas_datos = datos.get("lineas", [])
        
        # 1. Definir Líneas de Tiempo (Lifelines)
        for i, linea in enumerate(lineas_datos):
            alias = f"L{i}"
            lineas_puml.append(f"robust \"{linea['nombre']}\" as {alias}")
        
        lineas_puml.append("")
        
        # 2. Recolectar y ordenar cronológicamente los tiempos
        # 2. Recolectar y ordenar cronológicamente los tiempos
        tiempos_unicos = set()
        for linea in lineas_datos:
            for ev in linea.get("eventos", []):
                tiempos_unicos.add(float(ev["t"])) # <-- Cambiar int por float
        
        # 3. Dibujar los escalones
        # 3. Dibujar los escalones
        for t in sorted(tiempos_unicos):
            lineas_puml.append(f"@{t}")
            for i, linea in enumerate(lineas_datos):
                alias = f"L{i}"
                for ev in linea.get("eventos", []):
                    if float(ev["t"]) == t: # <-- Cambiar int por float
                        lineas_puml.append(f"{alias} is \"{ev['estado']}\"")
        
        lineas_puml.append("@enduml")
        contenido = "\n".join(lineas_puml)
        
        archivo_salida = "diagrama_tiempo.puml"
        with open(archivo_salida, 'w', encoding='utf-8') as f:
            f.write(contenido)
            
        print("\n¡ÉXITO! Se generó el diagrama escalonado.")
        print("Copia el texto de abajo y pégalo en https://www.planttext.com/")
        print("-" * 40)
        print(contenido)
        print("-" * 40)
        return

    # ==========================================================
    # MOTOR ENTERPRISE ARCHITECT (Secuencia, Estado, etc.)
    # ==========================================================
    print("Conectando con Enterprise Architect...")
    try:
        ea_app = win32com.client.Dispatch("EA.App")
        repo = ea_app.Repository
        paquete_actual = repo.GetTreeSelectedPackage()

        if paquete_actual is None:
            print("ERROR: Selecciona un paquete/carpeta en el explorador de EA primero.")
            return
            
        print(f"--- Generando modelo en: {paquete_actual.Name} ---")
        
        elementos = datos.get("elementos", [])
        relaciones = datos.get("relaciones", [])
        ids_elementos = {}
        
        # 1. CREAR ELEMENTOS
        for item in elementos:
            tipo_ea = item["tipo"]
            subtipo = None
            es_pequeno = False
            
            if tipo_ea == "Initial":
                tipo_ea = "StateNode"
                subtipo = 3
                es_pequeno = True
            elif tipo_ea in ["Final", "FinalState"]:
                tipo_ea = "StateNode"
                subtipo = 4
                es_pequeno = True
            elif tipo_ea in ["SoftwareSystem", "ExternalSystem", "Container", "MobileApp", "Database"]:
                tipo_ea = "Component"
                
            nuevo_elemento = paquete_actual.Elements.AddNew(item["nombre"], tipo_ea)

            if tipo_diagrama.lower().startswith("c4") and "descripcion_corta" in item:
                nuevo_elemento.Name = item["nombre"] + "\n" + item["descripcion_corta"]

            if "notas" in item:
                nuevo_elemento.Notes = item["notas"]

            if subtipo is not None:
                nuevo_elemento.Subtype = subtipo
                
            c4_estereotipos = {
                "Person": "Person",
                "SoftwareSystem": "Software System",
                "ExternalSystem": "External System",
                "Container": "Container",
                "MobileApp": "Mobile App",
                "Database": "Database"
            }
            if "estereotipo" in item:
                nuevo_elemento.Stereotype = item["estereotipo"]
            elif item["tipo"] in c4_estereotipos:
                nuevo_elemento.Stereotype = c4_estereotipos[item["tipo"]]

            nuevo_elemento.Update()
            ids_elementos[item["nombre"]] = {
                "id": nuevo_elemento.ElementID,
                "es_pequeno": es_pequeno
            }
            print(f"Elemento creado: {item['nombre']} [{item['tipo']}]")
            
        # 2. CREAR RELACIONES
        es_secuencia = (tipo_diagrama.lower() == "sequence")
        es_estado = (tipo_diagrama.lower() in ["statechart", "state machine", "state"])

        for rel in relaciones:
            nodo_origen = ids_elementos.get(rel["origen"])
            nodo_destino = ids_elementos.get(rel["destino"])

            if nodo_origen and nodo_destino:
                elemento_origen = repo.GetElementByID(nodo_origen["id"])
                tipos_conector_c4    = {"Uses": "Association", "Sends": "Association", "Reads/Writes": "Association"}
                tipos_conector_estado = {"Transition": "StateFlow"}
                tipo_conector = tipos_conector_c4.get(
                    rel["tipo"],
                    tipos_conector_estado.get(rel["tipo"], rel["tipo"])
                )
                conector = elemento_origen.Connectors.AddNew(rel.get("nombre", ""), tipo_conector)
                conector.SupplierID = nodo_destino["id"]
                
                if rel["tipo"] == "Dependency":
                        conector.Stereotype = "trace"
                
                if es_secuencia:
                    conector.SequenceNo = relaciones.index(rel) + 1 
                    
                conector.Update()
                print(f"Conexión: {rel['origen']} -- ({rel['tipo']})--> {rel['destino']}")
                
        # 3. MOTOR DE COORDENADAS
        es_c4 = tipo_diagrama.lower().startswith("c4")
        tipo_diagrama_ea = "Component" if es_c4 else tipo_diagrama
        diagrama = paquete_actual.Diagrams.AddNew(nombre_diagrama, tipo_diagrama_ea)
        diagrama.Update()

        eje_x = 150
        eje_y = 50
        espacio_x = 280 if es_c4 else (250 if es_estado else 220)
        espacio_y = 210 if es_c4 else (130 if es_estado else 130)

        for item in elementos:
            datos_elem = ids_elementos[item["nombre"]]

            if datos_elem["es_pequeno"]:
                w = 30
                h = 30
                offset_x = 45 if es_estado else 0
                offset_y = 0 if es_estado else 20
            elif es_c4:
                w = 180
                h = 160
                offset_x = 0
                offset_y = 0
            elif es_estado:
                w = 170
                h = 60
                offset_x = 0
                offset_y = 0
            else:
                w = 120
                h = 70
                offset_x = 0
                offset_y = 0

            # En EA: menos negativo = arriba, más negativo = abajo
            # fila 0 → t pequeño (arriba), fila N → t grande (abajo)
            if es_estado and "posicion" in item:
                pos = item["posicion"]
                col  = pos.get("col", 0)
                fila = pos.get("fila", 0)
                l = 150 + col * espacio_x + offset_x
                t = -(50 + fila * espacio_y + offset_y)
            else:
                l = eje_x + offset_x
                t = -(eje_y + offset_y)

            r = l + w
            b = t - h

            coords = f"l={l};r={r};t={t};b={b};"
            obj_diagrama = diagrama.DiagramObjects.AddNew(coords, "")
            obj_diagrama.ElementID = datos_elem["id"]

            style_parts = []
            if "color" in item:
                hex_color = item["color"].lstrip('#')
                rc, gc, bc = tuple(int(hex_color[i:i+2], 16) for i in (0, 2, 4))
                bgr_color = (bc * 65536) + (gc * 256) + rc
                style_parts.append(f"BCol={bgr_color}")
            if es_c4:
                style_parts.append("CptNotes=1")
            if style_parts:
                obj_diagrama.Style = ";".join(style_parts) + ";"
            obj_diagrama.Update()

            if es_secuencia:
                eje_x += espacio_x
            elif es_estado:
                if "posicion" not in item:
                    eje_y += espacio_y
            else:
                eje_x += espacio_x
                if eje_x > 900:
                    eje_x = 150
                    eje_y += espacio_y
                
        # 4. FRAGMENTOS (alt, opt, loop) — solo para diagramas de secuencia
        if es_secuencia:
            fragmentos = datos.get("fragmentos", [])
            y_base   = eje_y + 70 + 20
            alto_msg = 35
            x_izq    = 100
            x_der    = eje_x - espacio_x + 150

            for frag in fragmentos:
                desde     = frag.get("desde_mensaje", 1)
                hasta     = frag.get("hasta_mensaje", len(relaciones))
                tipo_frag = frag.get("tipo", "alt").upper()
                operandos = frag.get("operandos", [])

                t = -(y_base + (desde - 2) * alto_msg - 5)
                b = -(y_base + hasta * alto_msg + 20)

                # Intentar CombinedFragment; si falla, usar Note como fallback
                frag_elem = None
                for ea_tipo in ["CombinedFragment", "InteractionFragment", "Note"]:
                    try:
                        frag_elem = paquete_actual.Elements.AddNew(tipo_frag, ea_tipo)
                        if operandos:
                            guards = "  |  ".join(op.get("guarda", "") for op in operandos)
                            frag_elem.Notes = guards
                        frag_elem.Update()
                        print(f"Fragmento [{tipo_frag}] creado con tipo EA: {ea_tipo}")
                        break
                    except Exception as ex_frag:
                        print(f"  → {ea_tipo} no soportado: {ex_frag}")

                if frag_elem:
                    coords_frag = f"l={x_izq};r={x_der};t={t};b={b};"
                    obj_frag = diagrama.DiagramObjects.AddNew(coords_frag, "")
                    obj_frag.ElementID = frag_elem.ElementID
                    # Fondo blanco con borde negro para visibilidad
                    obj_frag.Style = "BCol=16777215;LCol=0;"
                    obj_frag.Update()

        repo.ReloadDiagram(diagrama.DiagramID)

        print("\n¡ÉXITO TOTAL!")
        print(f"Diagrama '{nombre_diagrama}' renderizado en Enterprise Architect.")
        
    except Exception as e:
        print(f"Error inesperado en EA: {e}")

if __name__ == "__main__":
    ejecutar_superscript()