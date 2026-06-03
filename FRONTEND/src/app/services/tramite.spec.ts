import { TestBed } from '@angular/core/testing';

import { Tramite } from './tramite';

describe('Tramite', () => {
  let service: Tramite;

  beforeEach(() => {
    TestBed.configureTestingModule({});
    service = TestBed.inject(Tramite);
  });

  it('should be created', () => {
    expect(service).toBeTruthy();
  });
});
