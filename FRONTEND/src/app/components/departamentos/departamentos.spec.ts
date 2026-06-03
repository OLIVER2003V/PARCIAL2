import { ComponentFixture, TestBed } from '@angular/core/testing';

import { Departamentos } from './departamentos';

describe('Departamentos', () => {
  let component: Departamentos;
  let fixture: ComponentFixture<Departamentos>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [Departamentos],
    }).compileComponents();

    fixture = TestBed.createComponent(Departamentos);
    component = fixture.componentInstance;
    await fixture.whenStable();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });
});
