// 由 dsxpod/products.py 產生，不要手改：.venv\Scripts\python.exe -m dsxpod.products
// 產品與 SKU 的唯一來源；sizing.js / scene.js / app.js 都從這裡讀。
export const PRODUCTS = {
 "dsx_pod": {
  "name": "NVIDIA DSX POD",
  "vendor": "NVIDIA",
  "short": "DSX POD",
  "url": "https://www.nvidia.com/en-us/data-center/products/dsx/pod/",
  "press_url": "https://nvidianews.nvidia.com/news/nvidia-introduces-dsx-pod-ai-factories-to-accelerate-europes-infrastructure-deployment",
  "cooling_mode": "warm_water_dry",
  "power": "800vdc_center",
  "band_rgb": [
   0.46,
   0.73,
   0.0
  ],
  "pitch_extra_y_m": 0.0,
  "skus": {
   "vera_rubin_nvl72": {
    "name": "Vera Rubin NVL72",
    "gpus": 504,
    "cpus": 252,
    "racks_compute": 7,
    "racks_network": 0,
    "rack_u": 48,
    "it_mw": 1.61,
    "rack_kw": 230.0,
    "liquid": true,
    "liquid_fraction": 0.85,
    "chillers": 0,
    "cdus": 1,
    "inrow_coolers": 0,
    "chws_c": null,
    "tcs_supply_default": "t45",
    "pf_inf_per_gpu": 50.0,
    "note": "每櫃 230 kW（Vera Rubin NVL72 Max-P；Max-Q 約 190 kW）",
    "url": "https://www.nvidia.com/en-us/data-center/vera-rubin-nvl72/",
    "vendor_url": null,
    "net_rack_kw": 0.0,
    "racks_total": 7,
    "pf_inf_total": 25200
   }
  }
 },
 "gadu": {
  "name": "GIGABYTE GADU",
  "vendor": "GIGABYTE",
  "short": "GADU",
  "url": "https://www.gigabyte.com/solutions/gadu",
  "press_url": null,
  "cooling_mode": "chilled_water",
  "power": "ac_power_skid",
  "band_rgb": [
   0.2,
   0.42,
   0.58
  ],
  "pitch_extra_y_m": 3.4,
  "skus": {
   "vera_rubin_nvl72": {
    "name": "NVIDIA Vera Rubin NVL72",
    "gpus": 288,
    "cpus": 144,
    "racks_compute": 4,
    "racks_network": 5,
    "rack_u": 48,
    "it_mw": 1.12,
    "rack_kw": 230.0,
    "liquid": true,
    "chillers": 2,
    "cdus": 2,
    "inrow_coolers": 6,
    "chws_c": 25.0,
    "tcs_supply_default": "t28",
    "pf_inf_per_gpu": 50.0,
    "url": "https://www.nvidia.com/en-us/data-center/vera-rubin-nvl72/",
    "vendor_url": "https://www.gigabyte.com/Enterprise/GIGAPOD-Pod-Scale/AI-DLC-POD_NVIDIA-Vera-Rubin-NVL72",
    "liquid_fraction": 0.85,
    "net_rack_kw": 40.0,
    "racks_total": 9,
    "pf_inf_total": 14400,
    "row": [
     [
      "cdu",
      0.35,
      1.2
     ],
     [
      "rack",
      1.57,
      0.6
     ],
     [
      "rack",
      2.19,
      0.6
     ],
     [
      "irc",
      2.81,
      0.3
     ],
     [
      "rack",
      3.13,
      0.6
     ],
     [
      "rack",
      3.75,
      0.6
     ],
     [
      "irc",
      4.37,
      0.3
     ],
     [
      "irc",
      4.69,
      0.3
     ],
     [
      "net",
      5.01,
      0.6
     ],
     [
      "net",
      5.63,
      0.6
     ],
     [
      "net",
      6.25,
      0.6
     ],
     [
      "net",
      6.87,
      0.6
     ],
     [
      "net",
      7.49,
      0.6
     ],
     [
      "irc",
      8.11,
      0.3
     ],
     [
      "irc",
      8.43,
      0.3
     ],
     [
      "irc",
      8.75,
      0.3
     ],
     [
      "cdu",
      9.07,
      1.2
     ]
    ]
   },
   "hgx_rubin_nvl8": {
    "name": "NVIDIA HGX Rubin NVL8",
    "gpus": 288,
    "cpus": 72,
    "racks_compute": 4,
    "racks_network": 5,
    "rack_u": 48,
    "it_mw": 1.03,
    "liquid": true,
    "chillers": 2,
    "cdus": 2,
    "inrow_coolers": 6,
    "chws_c": 25.0,
    "tcs_supply_default": "t28",
    "pf_inf_per_gpu": 50.0,
    "url": "https://www.nvidia.com/en-us/data-center/hgx/",
    "vendor_url": null,
    "liquid_fraction": 0.85,
    "rack_kw": 238.8,
    "net_rack_kw": 15.0,
    "racks_total": 9,
    "pf_inf_total": 14400,
    "row": [
     [
      "cdu",
      0.35,
      1.2
     ],
     [
      "rack",
      1.57,
      0.6
     ],
     [
      "rack",
      2.19,
      0.6
     ],
     [
      "irc",
      2.81,
      0.3
     ],
     [
      "rack",
      3.13,
      0.6
     ],
     [
      "rack",
      3.75,
      0.6
     ],
     [
      "irc",
      4.37,
      0.3
     ],
     [
      "irc",
      4.69,
      0.3
     ],
     [
      "net",
      5.01,
      0.6
     ],
     [
      "net",
      5.63,
      0.6
     ],
     [
      "net",
      6.25,
      0.6
     ],
     [
      "net",
      6.87,
      0.6
     ],
     [
      "net",
      7.49,
      0.6
     ],
     [
      "irc",
      8.11,
      0.3
     ],
     [
      "irc",
      8.43,
      0.3
     ],
     [
      "irc",
      8.75,
      0.3
     ],
     [
      "cdu",
      9.07,
      1.2
     ]
    ]
   },
   "gb300_nvl72": {
    "name": "NVIDIA GB300 NVL72",
    "gpus": 288,
    "cpus": 144,
    "racks_compute": 4,
    "racks_network": 5,
    "rack_u": 48,
    "it_mw": 0.7,
    "rack_kw": 136.0,
    "liquid": true,
    "chillers": 2,
    "cdus": 2,
    "inrow_coolers": 6,
    "chws_c": 25.0,
    "tcs_supply_default": "t28",
    "pf_inf_per_gpu": 15.3,
    "url": "https://www.nvidia.com/en-us/data-center/gb300-nvl72/",
    "vendor_url": null,
    "liquid_fraction": 0.85,
    "net_rack_kw": 31.2,
    "racks_total": 9,
    "pf_inf_total": 4406,
    "row": [
     [
      "cdu",
      0.35,
      1.2
     ],
     [
      "rack",
      1.57,
      0.6
     ],
     [
      "rack",
      2.19,
      0.6
     ],
     [
      "irc",
      2.81,
      0.3
     ],
     [
      "rack",
      3.13,
      0.6
     ],
     [
      "rack",
      3.75,
      0.6
     ],
     [
      "irc",
      4.37,
      0.3
     ],
     [
      "irc",
      4.69,
      0.3
     ],
     [
      "net",
      5.01,
      0.6
     ],
     [
      "net",
      5.63,
      0.6
     ],
     [
      "net",
      6.25,
      0.6
     ],
     [
      "net",
      6.87,
      0.6
     ],
     [
      "net",
      7.49,
      0.6
     ],
     [
      "irc",
      8.11,
      0.3
     ],
     [
      "irc",
      8.43,
      0.3
     ],
     [
      "irc",
      8.75,
      0.3
     ],
     [
      "cdu",
      9.07,
      1.2
     ]
    ]
   },
   "hgx_b300": {
    "name": "NVIDIA HGX B300",
    "gpus": 288,
    "cpus": 72,
    "racks_compute": 5,
    "racks_network": 2,
    "rack_u": 42,
    "it_mw": 0.56,
    "liquid": false,
    "chillers": 1,
    "cdus": 2,
    "inrow_coolers": 6,
    "chws_c": 15.0,
    "tcs_supply_default": "t28",
    "pf_inf_per_gpu": 18.0,
    "url": "https://www.nvidia.com/en-us/data-center/hgx/",
    "vendor_url": null,
    "liquid_fraction": 0.0,
    "rack_kw": 106.0,
    "net_rack_kw": 15.0,
    "racks_total": 7,
    "pf_inf_total": 5184,
    "row": [
     [
      "cdu",
      0.35,
      1.2
     ],
     [
      "rack",
      1.57,
      0.6
     ],
     [
      "rack",
      2.19,
      0.6
     ],
     [
      "irc",
      2.81,
      0.3
     ],
     [
      "rack",
      3.13,
      0.6
     ],
     [
      "rack",
      3.75,
      0.6
     ],
     [
      "irc",
      4.37,
      0.3
     ],
     [
      "rack",
      4.69,
      0.6
     ],
     [
      "irc",
      5.31,
      0.3
     ],
     [
      "net",
      5.63,
      0.6
     ],
     [
      "net",
      6.25,
      0.6
     ],
     [
      "irc",
      6.87,
      0.3
     ],
     [
      "irc",
      7.19,
      0.3
     ],
     [
      "irc",
      7.51,
      0.3
     ],
     [
      "cdu",
      7.83,
      1.2
     ]
    ]
   },
   "mi355x": {
    "name": "AMD Instinct MI355X",
    "gpus": 256,
    "cpus": 64,
    "racks_compute": 4,
    "racks_network": 3,
    "rack_u": 42,
    "it_mw": 0.57,
    "liquid": true,
    "chillers": 1,
    "cdus": 2,
    "inrow_coolers": 6,
    "chws_c": 25.0,
    "tcs_supply_default": "t28",
    "pf_inf_per_gpu": 20.0,
    "url": "https://www.amd.com/en/products/accelerators/instinct/mi350/mi355x.html",
    "vendor_url": null,
    "liquid_fraction": 0.85,
    "rack_kw": 131.2,
    "net_rack_kw": 15.0,
    "racks_total": 7,
    "pf_inf_total": 5120,
    "row": [
     [
      "cdu",
      0.35,
      1.2
     ],
     [
      "rack",
      1.57,
      0.6
     ],
     [
      "rack",
      2.19,
      0.6
     ],
     [
      "irc",
      2.81,
      0.3
     ],
     [
      "rack",
      3.13,
      0.6
     ],
     [
      "rack",
      3.75,
      0.6
     ],
     [
      "irc",
      4.37,
      0.3
     ],
     [
      "irc",
      4.69,
      0.3
     ],
     [
      "net",
      5.01,
      0.6
     ],
     [
      "net",
      5.63,
      0.6
     ],
     [
      "net",
      6.25,
      0.6
     ],
     [
      "irc",
      6.87,
      0.3
     ],
     [
      "irc",
      7.19,
      0.3
     ],
     [
      "irc",
      7.51,
      0.3
     ],
     [
      "cdu",
      7.83,
      1.2
     ]
    ]
   }
  }
 }
};
export const defaultSku = p => Object.keys(PRODUCTS[p].skus)[0];
export const spec = (p = 'dsx_pod', s = null) => [PRODUCTS[p], PRODUCTS[p].skus[s || defaultSku(p)]];
