import http from "k6/http";
import { check, sleep, group, fail } from "k6";
import { parseHTML } from "k6/html";
import { Counter, Trend } from "k6/metrics";

const journey = new Counter("journey");
const TESTID = __ENV.TEST_ID || "local-dev";

// const journey_duration = new Trend('journey_duration', true);

// const URL_BASE = "https://dev.theavotree.co.nz";
// const SHOP_ALL_URL = "https://dev.theavotree.co.nz/shop-all/";
// const PRODUCT_URL = __ENV.URL || "https://dev.theavotree.co.nz/product/hass";

const URL_BASE = "https://dev.theavotree.co.nz";
const SHOP_AVOCADO_URL = "https://dev.theavotree.co.nz/shop-avocados/";
const SHOP_ALL_URL = "https://dev.theavotree.co.nz/shop-all/";
const PRODUCT_URL = "https://dev.theavotree.co.nz/product/hass";

// constants.js
const ENDPOINTS = {
    HOME: { endpoint: "home_page", step: "HOME" },
    SHOP_AVO: { endpoint: "shop_avocado", step: "SHOP_AVO" },
    SHOP_ALL: { endpoint: "shop_all", step: "SHOP_ALL" },
    PDP: { endpoint: "PDP", step: "PDP" },
    ATC: { endpoint: "add_to_cart", step: "ATC" },
    CHECKOUT: {
        PAGE: { endpoint: "checkout_page", step: "CHECKOUT" },
        UOR: { endpoint: "update_order_review", step: "CHECKOUT" },
        FINISH: { endpoint: "checkout_finish", step: "CHECKOUT" },
    },
};

export const options = {
        stages: [
      { duration: '10s', target: 1 },  // giữ 1 VU trong 1 phút
    ],
//   scenarios: {
//     main: {
//       executor: "ramping-vus",
//       startVUs: 0,
//       stages: [
//         { duration: "30s", target: 20 },
//         { duration: "90s", target: 20 },
//         { duration: "30s", target: 50 },
//         { duration: "90s", target: 50 },
//         { duration: "40s", target: 0 },
//       ],
//       gracefulRampDown: "20s", // hạ tải êm
//       gracefulStop: "60s",     // cho phép VU chạy nốt vòng lặp hiện tại
//       tags: { testid: TESTID }, // tags áp dụng cho cả scenario
//     },
//   },

  thresholds: {
    http_req_failed: ["rate<0.05"],
    "journey{status:fail}": ["count==0"],
    checks: ["rate>0.95"],

    // checks theo step
    [`checks{step:${ENDPOINTS.PDP.step},testid:${TESTID}}`]: ["rate>0.99"],
    [`checks{step:${ENDPOINTS.ATC.step},testid:${TESTID}}`]: ["rate>0.99"],

    // discovery
    [`http_req_duration{endpoint:${ENDPOINTS.HOME.endpoint},step:${ENDPOINTS.HOME.step},testid:${TESTID}}`]:
      ["p(95)<4500", "p(99)<7500"],

    [`http_req_duration{endpoint:${ENDPOINTS.SHOP_AVO.endpoint},step:${ENDPOINTS.SHOP_AVO.step},testid:${TESTID}}`]:
      ["p(95)<7500", "p(99)<12000"],

    [`http_req_duration{endpoint:${ENDPOINTS.SHOP_ALL.endpoint},step:${ENDPOINTS.SHOP_ALL.step},testid:${TESTID}}`]:
      ["p(95)<7500", "p(99)<12000"],

    // PDP
    [`http_req_duration{endpoint:${ENDPOINTS.PDP.endpoint},step:${ENDPOINTS.PDP.step},testid:${TESTID}}`]:
      ["p(95)<7500", "p(99)<12000"],

    // ATC
    [`http_req_duration{endpoint:${ENDPOINTS.ATC.endpoint},step:${ENDPOINTS.ATC.step},testid:${TESTID}}`]:
      ["p(95)<15000", "p(99)<22500"],

    // checkout (3 pha)
    [`http_req_duration{endpoint:${ENDPOINTS.CHECKOUT.PAGE.endpoint},step:${ENDPOINTS.CHECKOUT.PAGE.step},testid:${TESTID}}`]:
      ["p(95)<22500", "p(99)<30000"],

    [`http_req_duration{endpoint:${ENDPOINTS.CHECKOUT.UOR.endpoint},step:${ENDPOINTS.CHECKOUT.UOR.step},testid:${TESTID}}`]:
      ["p(95)<15000", "p(99)<22500"],

    [`http_req_duration{endpoint:${ENDPOINTS.CHECKOUT.FINISH.endpoint},step:${ENDPOINTS.CHECKOUT.FINISH.step},testid:${TESTID}}`]:
      ["p(95)<30000", "p(99)<37500"],
  },

  discardResponseBodies: false,
};

let BASE;
try {
    BASE = new URL(URL_BASE).origin;
} catch (_) {
    BASE = __ENV.BASE || PRODUCT_URL.split("/").slice(0, 3).join("/");
}

function withEndpointTags(params = {}, ep) {
    const base = params || {};
    const baseTags = base.tags || {};
    return {
        ...base,
        tags: { ...baseTags, endpoint: ep.endpoint, step: ep.step },
    };
}

//  {
//      pid: 728952,
//      vid: 729076,
//      qty: 1,
//      attr: "box-25-price-box",
//      custom_box_price: 25,
//      referer: `${BASE}/product/hass/`,
//  },
//  {
//      pid: 728951,
//      vid: 729067,
//      qty: 15,
//      attr: "size-mini",
//      custom_box_price: 1.39,
//      referer: `${BASE}/product/gem/`,
//  },
// ];

// staging
const PRODUCTS = [
    {
        pid: 728951,
        vid: 729065,
        qty: 10,
        attr: "size-large",
        custom_box_price: 1,
        referer: `${BASE}/product/hass/?attribute_pa_optional-product=size-large&quantity=10`,
        url: `${BASE}/product/hass/?attribute_pa_optional-product=size-large&quantity=10`,
    },
    {
        pid: 728952,
        vid: 729078,
        qty: 5,
        attr: "size-jumbo",
        custom_box_price: 1.3,
        referer: `${BASE}/product/hass/?attribute_pa_optional-product=size-jumbo&quantity=5`,
        url: `${BASE}/product/hass/?attribute_pa_optional-product=size-jumbo&quantity=5`,
    },
];

function pick(arr) {
    return arr[(Math.random() * arr.length) | 0];
}

// ===== Helpers =====
function logFail(label, res, url, slice = 200) {
    console.log(`[${label} FAIL] status=${res.status} url=${url}`);
    console.log(`[${label} body] ${String(res.body || "").slice(0, slice)}`);
}

function checkTagged(target, checks, tags) {
    return check(target, checks, tags);
}

// ===== 1) Home =====
export function hitHome(ep = ENDPOINTS.HOME) {
    const res = http.get(URL_BASE, withEndpointTags({ timeout: "60s" }, ep));

    console.log(`hitHome: ${res}`);

    const ok = res.status === 200 && (res.body || "").length > 0;
    if (!ok) logFail("Home", res, URL_BASE);

    checkTagged(
        res,
        {
            "Home 200": (r) => r.status === 200,
            "Home body not empty": (r) => (r.body || "").length > 0,
        },
        { endpoint: ep.endpoint, step: ep.step }
    );

    sleep(0.3 + Math.random() * 0.5);
    return ok;
}

// ===== 2) Shop Avocado =====
export function hitShopAvocado(ep = ENDPOINTS.SHOP_AVO) {
    const res = http.get(
        SHOP_AVOCADO_URL,
        withEndpointTags({ timeout: "60s" }, ep)
    );

    console.log(`hitShopAvocado: ${res}`);

    const ok = res.status === 200 && (res.body || "").length > 0;
    if (!ok) logFail("ShopAvocado", res, SHOP_AVOCADO_URL);

    checkTagged(
        res,
        {
            "ShopAvocado Ok": (r) => r.status === 200,
            "ShopAvocado body not empty": (r) => (r.body || "").length > 0,
        },
        { endpoint: ep.endpoint, step: ep.step }
    );

    sleep(0.3 + Math.random() * 0.5);
    return ok;
}

// ===== 3) Shop All =====
export function hitShopAll(ep = ENDPOINTS.SHOP_ALL) {
    const res = http.get(
        SHOP_ALL_URL,
        withEndpointTags({ timeout: "60s" }, ep)
    );

    console.log(`hitShopAll: ${res}`);

    const ok = res.status === 200 && (res.body || "").length > 0;
    if (!ok) logFail("ShopAll", res, SHOP_ALL_URL);

    checkTagged(
        res,
        {
            "ShopAll OK": (r) => r.status === 200,
            "ShopAll body not empty": (r) => (r.body || "").length > 0,
        },
        { endpoint: ep.endpoint, step: ep.step }
    );

    sleep(0.3 + Math.random() * 0.5);
    return ok;
}

// ===== 4) PDP =====
export function hitPDP(p, ep = ENDPOINTS.PDP) {
    const res = http.get(p.url, withEndpointTags({ timeout: "60s" }, ep));
    console.log(`hitPDP: ${res}`);
    const ok = res.status === 200 && (res.body || "").length > 0;

    if (!ok) {
        logFail("PDP", res, p.url);
    }

    checkTagged(
        res,
        {
            "PDP 200": (r) => r.status === 200,
            "PDP body not empty": (r) => (r.body || "").length > 0,
        },
        { endpoint: ep.endpoint, step: ep.step }
    );

    sleep(0.3 + Math.random() * 0.5);
    return ok;
}

// ===== 5) Add to Cart =====
export function addToCart(p, ep = ENDPOINTS.ATC) {
    const HEADERS_ATC = {
        Accept: "application/json, text/javascript, */*; q=0.01",
        "Accept-Language": "en-US,en;q=0.9,vi;q=0.8",
        "Content-Type": "application/x-www-form-urlencoded; charset=UTF-8",
        "X-Requested-With": "XMLHttpRequest",
        Origin: BASE,
        Referer: p.url,
        "User-Agent": "k6-avotree-loadtest/1.0",
        "X-Test-Run": "avotree-loadtest",
    };

    const body = [
        `action=woocommerce_ajax_add_to_cart`,
        `product_id=${encodeURIComponent(p.pid)}`,
        `variation_id=${encodeURIComponent(p.vid)}`,
        `quantity=${encodeURIComponent(p.qty)}`,
        `custom_box_price=${encodeURIComponent(p.custom_box_price)}`,
        `attributes%5Battribute_pa_optional-product%5D=${encodeURIComponent(
            p.attr
        )}`,
        `memberships%5Bpa_frequency%5D=`,
        `memberships%5Bpa_dispatch-day%5D=`,
        `memberships%5Bstart_subcription%5D=`,
    ].join("&");

    const res = http.post(
        `${BASE}/wp-admin/admin-ajax.php`,
        body,
        withEndpointTags({ headers: HEADERS_ATC, timeout: "60s" }, ep)
    );
    console.log(`addToCart: ${res}`);

    let ok = res.status && res.status < 400;
    try {
        const j = res.json();
        ok = ok && (j?.error === false || j?.fragments || j?.success === true);
    } catch (_) {
        /* ignore parse error – một số site trả HTML */
    }

    if (!ok) logFail("ATC", res, `${BASE}/wp-admin/admin-ajax.php`, 300);

    checkTagged(
        res,
        { "Add to Cart": () => ok },
        { endpoint: ep.endpoint, step: ep.step }
    );

    sleep(0.3 + Math.random() * 0.5);
    return ok;
}

// ===== 6) Checkout (3 step) =====
export function runCheckout(ep = ENDPOINTS.CHECKOUT.PAGE) {
    const HEADERS_FORM = {
        Accept: "application/json, text/javascript, */*; q=0.01",
        "Accept-Language": "en-US,en;q=0.9,vi;q=0.8",
        "Content-Type": "application/x-www-form-urlencoded; charset=UTF-8",
        "X-Requested-With": "XMLHttpRequest",
        Origin: BASE,
        Referer: `${BASE}/checkout/`,
        "User-Agent": "k6-avotree-loadtest/1.0",
        "X-Test-Run": "avotree-loadtest",
    };

    // 6.1 GET checkout page
    const page = http.get(
        `${BASE}/checkout/`,
        withEndpointTags({ timeout: "60s" }, ep) // ep = { endpoint:"checkout_page", step:"CHECKOUT" }
    );

    console.log(`page: ${page}`);
    checkTagged(
        page,
        { "Checkout page OK": (r) => r.status && r.status < 400 },
        { endpoint: ep.endpoint, step: ep.step }
    );

    const $ = parseHTML(page.body);
    let checkoutNonce =
        $.find('input[name="woocommerce-process-checkout-nonce"]')
            .first()
            .attr("value") ||
        $.find('input[name="_wpnonce"]').first().attr("value") ||
        "";

    let uorNonce = "";
    {
        const m =
            page.body.match(
                /update_order_review_nonce["']\s*:\s*["']([^"']+)["']/
            ) ||
            page.body.match(/"update_order_review_nonce":"([a-zA-Z0-9]+)"/);
        if (m) uorNonce = m[1];
    }

    checkTagged(
        { checkoutNonce, uorNonce },
        {
            "Checkout nonce found": (v) =>
                v.checkoutNonce && v.checkoutNonce.length > 0,
            "UOR nonce found": (v) => v.uorNonce && v.uorNonce.length > 0,
        },
        { endpoint: ep.endpoint, step: ep.step }
    );

    // 6.2 POST update_order_review
    const email = `loadtest+${__VU}-${__ITER}@example.com`;
    const postDataPairs = [
        "wc-points-rewards-max-points=0",
        "billing_first_name=Test",
        "billing_last_name=User",
        `billing_email=${encodeURIComponent(email)}`,
        "billing_phone=0210000000",
        "billing_country=NZ",
        "billing_address_1=1 Test St",
        "billing_city=Auckland",
        "billing_postcode=1010",
        "payment_method=cod",
    ];
    const post_data = postDataPairs.join("&");

    const uorBody = [
        `security=${encodeURIComponent(uorNonce)}`,
        `payment_method=cod`,
        `country=NZ`,
        `state=`,
        `postcode=1010`,
        `city=Auckland`,
        `address=${encodeURIComponent("1 Test St")}`,
        `address_2=`,
        `s_country=NZ`,
        `s_state=`,
        `s_postcode=`,
        `s_city=Auckland`,
        `s_address=`,
        `s_address_2=`,
        `has_full_address=true`,
        `post_data=${post_data}`,
    ].join("&");

    const uor = http.post(
        `${BASE}/?wc-ajax=update_order_review`,
        uorBody,
        withEndpointTags(
            { headers: HEADERS_FORM, timeout: "60s" },
            ENDPOINTS.CHECKOUT.UOR
        )
    );

    console.log(`uor: ${uor}`);
    checkTagged(
        uor,
        { "UOR 200": (r) => r.status >= 200 && r.status < 400 },
        {
            endpoint: ENDPOINTS.CHECKOUT.UOR.endpoint,
            step: ENDPOINTS.CHECKOUT.UOR.step,
        }
    );

    // 6.3 POST checkout finish
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
        `woocommerce-process-checkout-nonce=${encodeURIComponent(
            checkoutNonce
        )}`,
        `_wp_http_referer=%2F%3Fwc-ajax%3Dupdate_order_review`,
    ].join("&");

    const co = http.post(
        `${BASE}/?wc-ajax=checkout`,
        form,
        withEndpointTags(
            { headers: HEADERS_FORM, timeout: "60s" },
            ENDPOINTS.CHECKOUT.FINISH
        )
    );

    console.log(`cocoOk: ${JSON.stringify(co)}`);

    let coOk = co.status && co.status < 400;
    try {
        const j = co.json();
        if (j && j.result && j.result !== "success") {
            coOk = false;
            console.log(
                `[Checkout ERROR] result=${j.result} message=${
                    j.messages || ""
                }`
            );
        }

    } catch (_) {
        /* ignore parse error – một số site trả HTML */
    }

    if (!coOk) logFail("Checkout", co, `${BASE}/?wc-ajax=checkout`, 300);

    checkTagged(
        co,
        { "Checkout OK": () => coOk },
        {
            endpoint: ENDPOINTS.CHECKOUT.FINISH.endpoint,
            step: ENDPOINTS.CHECKOUT.FINISH.step,
        }
    );

    sleep(0.3 + Math.random() * 0.5);
    return coOk;
}

export default function () {
    let journeyFailed = false;
    group("01-Discovery", () => {
        if (!hitHome(ENDPOINTS.HOME)) journeyFailed = true;
        if (!hitShopAvocado(ENDPOINTS.SHOP_AVO)) journeyFailed = true;
        if (!hitShopAll(ENDPOINTS.SHOP_ALL)) journeyFailed = true;
    });

    const p = pick(PRODUCTS);

    group("02-PDP", () => {
        const ok = hitPDP(p, ENDPOINTS.PDP);
        if (!ok) journeyFailed = true;
    });

    group("03-ATC", () => {
        const ok = addToCart(p, ENDPOINTS.ATC);
        if (!ok) journeyFailed = true;
    });

  group("04-Checkout", () => {
    const ok = runCheckout(ENDPOINTS.CHECKOUT.PAGE);
    if (!ok) journeyFailed = true;
  });

    if (journeyFailed) {
    journey.add(1, { status: "fail" });
    fail("Journey failed (soft-fail at end).");
  } else {
    journey.add(1, { status: "ok" });
  }

  sleep(0.3 + Math.random() * 0.5);

}

