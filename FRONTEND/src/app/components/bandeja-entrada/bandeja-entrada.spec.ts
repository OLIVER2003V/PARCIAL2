import { ComponentFixture, TestBed } from '@angular/core/testing';

import { BandejaEntrada } from './bandeja-entrada';

describe('BandejaEntrada', () => {
  let component: BandejaEntrada;
  let fixture: ComponentFixture<BandejaEntrada>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [BandejaEntrada],
    }).compileComponents();

    fixture = TestBed.createComponent(BandejaEntrada);
    component = fixture.componentInstance;
    await fixture.whenStable();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });
});
