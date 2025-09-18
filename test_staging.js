import http from 'k6/http';
import { check, sleep, group } from 'k6';
import { parseHTML } from 'k6/html';

export const options = {
  // stages: [
  //   { duration: '2m', target: 100 },  // ramp lên 100 user
  //   { duration: '5m', target: 100 },  // giữ 100 user
  //   { duration: '2m', target: 200 },  // tăng lên 200 user
  //   { duration: '5m', target: 200 },  // giữ 200 user
  //   { duration: '2m', target: 0 },    // hạ nhiệt
  // ],
  stages: [
    { duration: '10s', target: 20 },   // ramp lên 20 user
    { duration: '20s', target: 20 },   // giữ 20 user
    { duration: '10s', target: 50 },   // tăng lên 50 user
    { duration: '20s', target: 50 },   // giữ 50 user
    { duration: '10s', target: 0 },    // hạ nhiệt
  ],
  // stages: [
  //   { duration: '30s', target: 20 },   // ramp lên 20 user
  //   { duration: '90s', target: 20 },   // giữ 20 user (1.5 phút)
  //   { duration: '30s', target: 50 },   // ramp lên 50 user
  //   { duration: '90s', target: 50 },   // giữ 50 user (1.5 phút)
  //   { duration: '40s', target: 0 },    // hạ nhiệt
  // ],
  thresholds: {
    http_req_failed: ['rate<0.01'],
    'http_req_duration{endpoint:PDP}':               ['p(95)<3000'],
    'http_req_duration{endpoint:add_to_cart}':       ['p(95)<1200'],
    'http_req_duration{endpoint:update_order_review}':     ['p(95)<2000'],
    'http_req_duration{endpoint:checkout_page}':     ['p(95)<3000'],
    'http_req_duration{endpoint:checkout}':          ['p(95)<3500'],
    checks: ['rate>0.98'],
  },
  discardResponseBodies: false, // bật true nếu bạn chỉ quan tâm latency
};

const URL_BASE = 'https://staging.theavotree.co.nz/';
const PRODUCT_URL = __ENV.URL || 'https://staging.theavotree.co.nz/product/hass/?attribute_pa_optional-product=box-20-price-box&quantity=1';
// đồng bộ BASE với URL để cookie/giỏ hàng cùng domain
let BASE;
try {
  BASE =  new URL(URL_BASE).origin;
} catch (_) {
  // Fallback nếu bản k6 của bạn không hỗ trợ constructor URL
  BASE = __ENV.BASE || PRODUCT_URL.split('/').slice(0, 3).join('/');
}

let HEADERS_FORM = {
  'Content-Type': 'application/x-www-form-urlencoded; charset=UTF-8',
  'X-Requested-With': 'XMLHttpRequest',
  'User-Agent': 'k6-avotree-loadtest/1.0',
  'X-Test-Run': 'avotree-loadtest',
  'Referer': PRODUCT_URL,
};

const PRODUCTS = [
  { pid: 728801, vid: 729292, qty: 1, attr: 'box-25-price-box', custom_box_price: 25 }, //GEM
  { pid: 728823, vid: 728826, qty: 15, attr: 'size-mini', custom_box_price: 1.39 }, //Hass
];


function pick(arr) {
  return arr[(Math.random() * arr.length) | 0];
}

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
    const p = pick(PRODUCTS); // chọn ngẫu nhiên 1 sản phẩm
    const body =
    `action=woocommerce_ajax_add_to_cart` +   
    `&product_id=${p.pid}` +
    `&variation_id=${p.vid}` +
    `&quantity=${p.qty}` +
    `&custom_box_price=${p.custom_box_price}` +
    `&attributes%5Battribute_pa_optional-product%5D=${encodeURIComponent(p.attr)}` +
    `&memberships%5Bpa_frequency%5D=` +
    `&memberships%5Bpa_dispatch-day%5D=` +
    `&memberships%5Bstart_subcription%5D=`;
  
    const res = http.post(`${BASE}/?wc-ajax=add_to_cart`, body, {
      headers: HEADERS_FORM, timeout: '60s', tags: { endpoint: 'add_to_cart' }
    });  
    let ok = res.status === 200;
    try {
      const j = res.json();
      ok = ok && (j?.error === false || j?.fragments);
    } catch (_) {}
    check(res, { 'ATC ok': () => ok });
    sleep(1);
  });


 // 4) Checkout
 group('Checkout', () => {
  const HEADERS_FORM = {
    'Accept': 'application/json, text/javascript, */*; q=0.01',
    'Accept-Language': 'en-US,en;q=0.9,vi;q=0.8',
    'Content-Type': 'application/x-www-form-urlencoded; charset=UTF-8',
    'X-Requested-With': 'XMLHttpRequest',
    'Origin': BASE,
    'Referer': `${BASE}/checkout/`,
    'User-Agent': 'k6-avotree-loadtest/1.0',
    'X-Test-Run': 'avotree-loadtest',
  };
  // 1. Mở trang checkout
  const page = http.get(`${BASE}/checkout/`, { timeout: '60s', tags: { endpoint: 'checkout_page' } });
  check(page, { 'Checkout page 200': r => r.status === 200 });

  const $ = parseHTML(page.body);
  let nonce =
  $.find('input[name="woocommerce-process-checkout-nonce"]').first().attr('value') ||
  $.find('input[name="_wpnonce"]').first().attr('value') || '';

// 2) update_order_review (Woo có thể rotate nonce)
  const uor = http.post(
    `${BASE}/?wc-ajax=update_order_review`,
    `security=${encodeURIComponent(nonce)}&payment_method=cod&country=NZ`,
    { headers: HEADERS_FORM, timeout:'60s', tags:{endpoint:'update_order_review'} }
  );

// 3) Nếu fragments trả về nonce mới -> dùng nonce mới
try {
  const j = uor.json();              // { result, fragments, ... }
  if (j?.fragments) {
    const html = Object.values(j.fragments).join('\n');   // ghép tất cả fragment HTML
    // tìm input nonce trong fragment mới
    const m =
      html.match(/name=["']woocommerce-process-checkout-nonce["']\s+value=["']([^"']+)["']/) ||
      html.match(/name=["']_wpnonce["']\s+value=["']([^"']+)["']/);
    if (m && m[1]) nonce = m[1];     // overwrite nonce
  }
} catch (_) { /* ignore */ }

  // 4. Build form checkout
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
    `payment_method=cod`,
    `terms=on`,
    `woocommerce-process-checkout-nonce=${encodeURIComponent(nonce)}`,
    `_wp_http_referer=%2F%3Fwc-ajax%3Dupdate_order_review`
  ].join('&');

  // 5. Thực hiện checkout
  const res = http.post(`${BASE}/?wc-ajax=checkout`, form, {
    headers: HEADERS_FORM,
    timeout: '60s',
    tags: { endpoint: 'checkout' },
  });

  check(res, { 'Checkout ok': r => r.status === 200 || r.status === 302 });
});

  sleep(1 + Math.random()); // 1–2s
}