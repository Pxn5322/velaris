import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { App } from 'supertest/types.js';
import { AppModule } from './../src/app.module.js';
import { configureApp } from './../src/app.setup.js';

describe('AppController (e2e)', () => {
  let app: INestApplication<App>;

  beforeEach(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleFixture.createNestApplication();
    // Production HTTP configuration (CORS) - see src/app.setup.ts.
    configureApp(app);
    await app.init();
  });

  it('/ (GET)', () => {
    return request(app.getHttpServer())
      .get('/')
      .expect(200)
      .expect('Hello World!');
  });

  // Live browser verification (T2.04 follow-up): the portal on
  // http://localhost:3001 calls this API cross-origin with a Bearer header,
  // so the browser first sends a CORS preflight. Without an explicit
  // origin allowlist the preflight 404s and every browser request fails
  // with net::ERR_FAILED - a defect the mocked CI journeys cannot see.
  it('answers a cross-origin preflight from the web app origin', async () => {
    const response = await request(app.getHttpServer())
      .options('/auth/session')
      .set('Origin', 'http://localhost:3001')
      .set('Access-Control-Request-Method', 'GET')
      .set('Access-Control-Request-Headers', 'authorization,content-type');

    expect([200, 204]).toContain(response.status);
    expect(response.headers['access-control-allow-origin']).toBe(
      'http://localhost:3001',
    );
    expect(response.headers['access-control-allow-headers']).toMatch(
      /authorization/i,
    );
  });

  it('stamps CORS headers on actual responses', async () => {
    const response = await request(app.getHttpServer())
      .get('/')
      .set('Origin', 'http://localhost:3001')
      .expect(200);

    expect(response.headers['access-control-allow-origin']).toBe(
      'http://localhost:3001',
    );
  });

  afterEach(async () => {
    await app.close();
  });
});
