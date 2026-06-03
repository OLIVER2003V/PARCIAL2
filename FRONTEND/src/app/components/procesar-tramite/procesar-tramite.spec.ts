import { ComponentFixture, TestBed } from '@angular/core/testing';

import { ProcesarTramite } from './procesar-tramite';

describe('ProcesarTramite', () => {
  let component: ProcesarTramite;
  let fixture: ComponentFixture<ProcesarTramite>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [ProcesarTramite],
    }).compileComponents();

    fixture = TestBed.createComponent(ProcesarTramite);
    component = fixture.componentInstance;
    await fixture.whenStable();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });
});
