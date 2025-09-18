import http from 'k6/http';
import { check, sleep, group } from 'k6';
import { parseHTML } from 'k6/html';

export const options = {
  stages: [
    { duration: '2m', target: 100 },  // ramp lên 100 user
    { duration: '5m', target: 100 },  // giữ 100 user
    { duration: '2m', target: 200 },  // tăng lên 200 user
    { duration: '5m', target: 200 },  // giữ 200 user
    { duration: '2m', target: 0 },    // hạ nhiệt
  ],
  // stages: [
  //   { duration: '10s', target: 20 },   // ramp lên 20 user
  //   { duration: '20s', target: 20 },   // giữ 20 user
  //   { duration: '10s', target: 50 },   // tăng lên 50 user
  //   { duration: '20s', target: 50 },   // giữ 50 user
  //   { duration: '10s', target: 0 },    // hạ nhiệt
  // ],
  thresholds: {
    http_req_failed: ['rate<0.01'],
    http_req_duration: ['p(95)<5000'],
    checks: ['rate>0.98'],
  },
  discardResponseBodies: false, // bật true nếu bạn chỉ quan tâm latency
};

const URL_BASE = 'https://dev.theavotree.co.nz';
const PRODUCT_URL = __ENV.URL || 'https://dev.theavotree.co.nz/product/hass/?attribute_pa_optional-product=box-20-price-box&quantity=1';
// đồng bộ BASE với URL để cookie/giỏ hàng cùng domain
let BASE;
try {
  BASE =  new URL(URL_BASE).origin;
} catch (_) {
  // Fallback nếu bản k6 của bạn không hỗ trợ constructor URL
  BASE = __ENV.BASE || PRODUCT_URL.split('/').slice(0, 3).join('/');
}

const HEADERS_FORM = {
  'Content-Type': 'application/x-www-form-urlencoded; charset=UTF-8',
  'X-Requested-With': 'XMLHttpRequest',
  'User-Agent': 'k6-avotree-loadtest/1.0',
  'X-Test-Run': 'avotree-loadtest',
  'Referer': PRODUCT_URL,
};

export default function () {
  // 1) PDP
  group('PDP', () => {
    const res = http.get(PRODUCT_URL);
    check(res, {
      'PDP 200': r => r.status === 200,
      'PDP body': r => (r.body || '').length > 0,
    });
    sleep(1);
  });

  // 2) Add to Cart (wc-ajax)
  group('ATC', () => {
    // payload bạn chụp từ DevTools
    const body =
      'product_id=728951' +
      '&variation_id=729067' +
      '&quantity=15' +
      '&custom_box_price=1.39' +
      '&attributes%5Battribute_pa_optional-product%5D=size-mini' +
      '&memberships%5Bpa_frequency%5D=' +
      '&memberships%5Bpa_dispatch-day%5D=' +
      '&memberships%5Bstart_subcription%5D=';

      const res = http.post(
        `${BASE}/?wc-ajax=add_to_cart`,
        body,
        { headers: HEADERS_FORM, tags: { endpoint: 'add_to_cart' } }
      );

    let ok = res.status === 200;
    try {
      const j = res.json();
      ok = ok && (j?.error === false || j?.fragments);
    } catch (_) {}
    check(res, { 'ATC ok': () => ok });
    sleep(1);
  });

  // 3) Cart
  group('Cart', () => {
    const cart = http.get(`${BASE}/cart/`);
    check(cart, { 'Cart 200': r => r.status === 200 });
  });

  // 4) Checkout (lấy nonce rồi POST wc-ajax=checkout)
  group('Checkout', () => {
    const coPage = http.get(`${BASE}/checkout/`);
    check(coPage, { 'Checkout page 200': r => r.status === 200 });

    const $ = parseHTML(coPage.body);
    const nonce = $.find('input[name="woocommerce-process-checkout-nonce"]').first().attr('value') || '';
    check(nonce, { 'Got nonce': v => !!v });

    const email = `loadtest+${__VU}-${__ITER}@example.com`;
    const form = [
      `billing_first_name=Test`,
      `billing_last_name=User`,
      `billing_email=${encodeURIComponent(email)}`,
      `billing_phone=0210000000`,
      `billing_address_1=1 Test St`,
      `billing_city=Auckland`,
      `billing_postcode=1010`,
      `billing_country=NZ`,
      `ship_to_different_address=0`,
      `payment_method=cod`,
      `terms=on`,
      `woocommerce-process-checkout-nonce=${encodeURIComponent(nonce)}`,
    ].join('&');

    const co = http.post(`${BASE}/?wc-ajax=checkout`, form, { headers: HEADERS_FORM });
    check(co, { 'Checkout ok (200/302)': r => r.status === 200 || r.status === 302 });
  });

  sleep(1 + Math.random()); // 1–2s
}