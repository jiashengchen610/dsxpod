// 由 dsxpod/capex.py 產生，不要手改：.venv\Scripts\python.exe -m dsxpod.capex
// 造價：機櫃 + 地上物的設備與材料（不含土地、施工人力）；係數同時寫進 USD（/World/Plant cost:coef:*）。
import { PRODUCTS } from './products.js';
export const C = {
 "rack_vr_nvl72": 7800000.0,
 "rack_gb300_nvl72": 4000000.0,
 "srv_hgx_b300": 450000.0,
 "srv_mi355x_retail": 690000.0,
 "retail_to_odm": 0.7,
 "gpus_per_server": 8.0,
 "network_frac": 0.1,
 "container": 250000.0,
 "cdu": 300000.0,
 "inrow_cooler": 30000.0,
 "dry_cooler_per_kw": 90.0,
 "dry_module_kw": 430.0,
 "dry_modules_per_pod": 3.0,
 "chiller_per_kw": 250.0,
 "chiller_margin": 1.2,
 "trim_fws_supply_c": 42.0,
 "trim_delta_t_k": 10.4,
 "trim_approach_k": 5.0,
 "gadu_chiller_design": 1.03,
 "power_center_per_mw": 600000.0,
 "substation_per_mw": 270000.0,
 "pad_thick_m": 0.2,
 "concrete_m3": 190.0,
 "rebar_frac": 0.4,
 "gravel_thick_m": 0.15,
 "gravel_t_m3": 1.6,
 "gravel_t": 45.0,
 "paved_frac": 0.08,
 "asphalt_thick_m": 0.1,
 "asphalt_t_m3": 2.4,
 "asphalt_t": 100.0,
 "fence_m": 18.0,
 "building": 300000.0
};
export const COEF_META = {
 "rack_vr_nvl72": {
  "unit": "USD/rack",
  "label": "NVIDIA Vera Rubin NVL72 rack",
  "source": "Morgan Stanley BOM analysis 2026-05 (ODM procurement; range $5-9M)",
  "confidence": "medium"
 },
 "rack_gb300_nvl72": {
  "unit": "USD/rack",
  "label": "NVIDIA GB300 NVL72 rack",
  "source": "Morgan Stanley 2026-05; Loop Capital (range $3.7-6.5M)",
  "confidence": "medium"
 },
 "srv_hgx_b300": {
  "unit": "USD/server",
  "label": "HGX B300 8-GPU server",
  "source": "reseller/DGX quotes 2026 ($300-650k, mid)",
  "confidence": "medium"
 },
 "srv_mi355x_retail": {
  "unit": "USD/server",
  "label": "AMD MI355X 8-GPU server, EU retail ex-VAT",
  "source": "Servermall listing (EUR 640k, GIGABYTE / Dell)",
  "confidence": "medium"
 },
 "retail_to_odm": {
  "unit": "ratio",
  "label": "retail -> ODM procurement factor",
  "source": "HGX B300: $450k mid / $647k configured retail",
  "confidence": "low"
 },
 "gpus_per_server": {
  "unit": "GPU",
  "label": "GPUs per HGX / OAM server",
  "source": "vendor specs",
  "confidence": "high"
 },
 "network_frac": {
  "unit": "ratio",
  "label": "scale-out network as fraction of compute hardware",
  "source": "assumption (same for all SKUs)",
  "confidence": "low"
 },
 "container": {
  "unit": "USD/unit",
  "label": "container shell + fire suppression + piping + panels",
  "source": "estimate",
  "confidence": "low"
 },
 "cdu": {
  "unit": "USD/CDU",
  "label": "2.3 MW class CDU",
  "source": "CDU market $150-400/kW",
  "confidence": "medium"
 },
 "inrow_cooler": {
  "unit": "USD/unit",
  "label": "in-row cooler",
  "source": "estimate",
  "confidence": "low"
 },
 "dry_cooler_per_kw": {
  "unit": "USD/kW",
  "label": "dry cooler, per kW heat rejection",
  "source": "relative benchmarks only (2.6x open tower)",
  "confidence": "low"
 },
 "dry_module_kw": {
  "unit": "kW",
  "label": "heat rejection per cooler module (Vertiv MCV430)",
  "source": "Vertiv model rating",
  "confidence": "medium"
 },
 "dry_modules_per_pod": {
  "unit": "count",
  "label": "cooler modules per DSX POD (N+1)",
  "source": "layout",
  "confidence": "high"
 },
 "chiller_per_kw": {
  "unit": "USD/kW",
  "label": "air-cooled chiller, per kW cooling",
  "source": "techno-economic literature (arXiv 2608.10999)",
  "confidence": "medium"
 },
 "chiller_margin": {
  "unit": "ratio",
  "label": "chiller rated capacity / design deficit",
  "source": "same as energy model",
  "confidence": "high"
 },
 "trim_fws_supply_c": {
  "unit": "C",
  "label": "DSX facility water supply (45 C TCS - 3 K CDU)",
  "source": "energy model",
  "confidence": "high"
 },
 "trim_delta_t_k": {
  "unit": "K",
  "label": "facility water delta-T at 45 C (GB300 flow curve)",
  "source": "energy model",
  "confidence": "high"
 },
 "trim_approach_k": {
  "unit": "K",
  "label": "dry cooler approach",
  "source": "energy model",
  "confidence": "high"
 },
 "gadu_chiller_design": {
  "unit": "ratio",
  "label": "GADU chiller design heat / IT (incl. envelope)",
  "source": "usd_out.build_gadu_unit",
  "confidence": "high"
 },
 "power_center_per_mw": {
  "unit": "USD/MW",
  "label": "per-unit 800 VDC power center / AC power skid",
  "source": "BofA via Eaton: UPS $0.8M + switchgear $0.5M per MW, discounted",
  "confidence": "low"
 },
 "substation_per_mw": {
  "unit": "USD/MW",
  "label": "customer-owned campus substation",
  "source": "DC Market Insights 2025",
  "confidence": "medium"
 },
 "pad_thick_m": {
  "unit": "m",
  "label": "concrete pad thickness",
  "source": "assumption",
  "confidence": "medium"
 },
 "concrete_m3": {
  "unit": "USD/m3",
  "label": "ready-mix concrete",
  "source": "2026 US public bids (~$145/yd3)",
  "confidence": "high"
 },
 "rebar_frac": {
  "unit": "ratio",
  "label": "reinforcement as fraction of concrete",
  "source": "assumption",
  "confidence": "low"
 },
 "gravel_thick_m": {
  "unit": "m",
  "label": "gravel surfacing thickness",
  "source": "assumption",
  "confidence": "medium"
 },
 "gravel_t_m3": {
  "unit": "t/m3",
  "label": "gravel density",
  "source": "engineering handbook",
  "confidence": "high"
 },
 "gravel_t": {
  "unit": "USD/t",
  "label": "crushed gravel",
  "source": "supplier price guides",
  "confidence": "medium"
 },
 "paved_frac": {
  "unit": "ratio",
  "label": "paved road fraction of site area",
  "source": "assumption",
  "confidence": "low"
 },
 "asphalt_thick_m": {
  "unit": "m",
  "label": "asphalt thickness",
  "source": "assumption",
  "confidence": "medium"
 },
 "asphalt_t_m3": {
  "unit": "t/m3",
  "label": "asphalt density",
  "source": "engineering handbook",
  "confidence": "high"
 },
 "asphalt_t": {
  "unit": "USD/t",
  "label": "hot-mix asphalt",
  "source": "2026 US public bids ($70-130/t)",
  "confidence": "high"
 },
 "fence_m": {
  "unit": "USD/m",
  "label": "chain-link fence material",
  "source": "Fixr material-only ($5.3/ft)",
  "confidence": "medium"
 },
 "building": {
  "unit": "USD/block",
  "label": "control / substation building",
  "source": "estimate",
  "confidence": "low"
 }
};

const LIQ = 0.85;
export function itUnitPrice(product, sku, c = C) {
  const sk = PRODUCTS[product].skus[sku];
  if (sku === 'vera_rubin_nvl72') return sk.racks_compute * c.rack_vr_nvl72;
  if (sku === 'gb300_nvl72') return sk.racks_compute * c.rack_gb300_nvl72;
  const servers = sk.gpus / c.gpus_per_server;
  if (sku === 'hgx_b300') return servers * c.srv_hgx_b300;
  if (sku === 'hgx_rubin_nvl8') return servers * c.rack_vr_nvl72 / 72 * c.gpus_per_server;
  if (sku === 'mi355x') return servers * c.srv_mi355x_retail * c.retail_to_odm;
  throw new Error(sku);
}
export function capex(layout, product, sku, cooling, riseK = 0, tMaxC = 35, c = C) {
  const sk = PRODUCTS[product].skus[sku], n = layout.n_pods, itMW = layout.it_mw;
  const it = { compute: n * itUnitPrice(product, sku, c) }; it.network = it.compute * c.network_frac;
  const f = { container: n * c.container, cdu: n * sk.cdus * c.cdu, inrow: n * sk.inrow_coolers * c.inrow_cooler };
  if (product === 'dsx_pod') {
    f.dry_cooler = n * c.dry_modules_per_pod * c.dry_module_kw * c.dry_cooler_per_kw;
    let chillerKW = 0;
    if (cooling === 'dry_plus_chiller') {
      const reachable = tMaxC + riseK + c.trim_approach_k;
      const frac = Math.min(1, Math.max(0, (c.trim_fws_supply_c + c.trim_delta_t_k - reachable) / c.trim_delta_t_k));
      chillerKW = (1 - frac) * itMW * 1000 * LIQ * c.chiller_margin;
    }
    f.chiller = chillerKW * c.chiller_per_kw;
  } else {
    f.dry_cooler = 0;
    f.chiller = n * sk.it_mw * 1000 * c.gadu_chiller_design * c.chiller_margin * c.chiller_per_kw;
  }
  f.power_center = itMW * c.power_center_per_mw;
  f.substation = itMW * c.substation_per_mw;
  const [sx, sy] = layout.site_m, area = sx * sy;
  const pads = layout.blocks.reduce((s, b) => s + (b.length + 5) * (b.width + 5), 0);
  f.site_works = pads * c.pad_thick_m * c.concrete_m3 * (1 + c.rebar_frac) + area * c.gravel_thick_m * c.gravel_t_m3 * c.gravel_t
    + area * c.paved_frac * c.asphalt_thick_m * c.asphalt_t_m3 * c.asphalt_t + 2 * (sx + sy) * c.fence_m;
  f.buildings = layout.n_blocks * c.building;
  const items = { ...it, ...f }, sum = o => Object.values(o).reduce((a, b) => a + b, 0);
  const tIt = sum(it), tF = sum(f);
  return { items, it: tIt, facility: tF, total: tIt + tF };
}
