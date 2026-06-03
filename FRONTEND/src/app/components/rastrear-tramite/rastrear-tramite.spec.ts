import { ComponentFixture, TestBed } from '@angular/core/testing';

import { RastrearTramite } from './rastrear-tramite';

describe('RastrearTramite', () => {
  let component: RastrearTramite;
  let fixture: ComponentFixture<RastrearTramite>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [RastrearTramite],
    }).compileComponents();

    fixture = TestBed.createComponent(RastrearTramite);
    component = fixture.componentInstance;
    await fixture.whenStable();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });
});
