import { ComponentFixture, TestBed } from '@angular/core/testing';

import { AdminProcesos } from './admin-procesos';

describe('AdminProcesos', () => {
  let component: AdminProcesos;
  let fixture: ComponentFixture<AdminProcesos>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [AdminProcesos],
    }).compileComponents();

    fixture = TestBed.createComponent(AdminProcesos);
    component = fixture.componentInstance;
    await fixture.whenStable();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });
});
