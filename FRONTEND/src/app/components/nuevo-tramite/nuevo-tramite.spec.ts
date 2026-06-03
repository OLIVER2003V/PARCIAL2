import { ComponentFixture, TestBed } from '@angular/core/testing';

import { NuevoTramite } from './nuevo-tramite';

describe('NuevoTramite', () => {
  let component: NuevoTramite;
  let fixture: ComponentFixture<NuevoTramite>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [NuevoTramite],
    }).compileComponents();

    fixture = TestBed.createComponent(NuevoTramite);
    component = fixture.componentInstance;
    await fixture.whenStable();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });
});
