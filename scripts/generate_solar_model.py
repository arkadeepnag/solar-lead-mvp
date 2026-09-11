"""Offline solar-model pipeline for Prabha.

This is intentionally a build-time/data-preparation script, not a runtime backend.
It uses pvlib for solar position / irradiance / PV modeling and writes the resulting
values into public/data for the static React demo.

Example:
  pip install pvlib geopandas shapely rasterio pandas
  python scripts/generate_solar_model.py

For a production deployment, replace the demo GeoJSON/grid with authoritative parcel
geometry and a licensed/open solar-resource raster (for example Global Solar Atlas or
NREL India GHI/DNI) and preserve the same output schema.
"""
from pathlib import Path
import json, math

ROOT = Path(__file__).resolve().parents[1]
OUT = ROOT / 'public' / 'data'
OUT.mkdir(parents=True, exist_ok=True)

try:
    import pandas as pd
    import pvlib
    from pvlib.location import Location
except ImportError as exc:
    raise SystemExit('Install pvlib and pandas first: pip install pvlib pandas') from exc

LAT, LON, TZ = 34.165, 77.585, 'Asia/Kolkata'
loc = Location(LAT, LON, TZ, altitude=3500, name='Leh')
idx = pd.date_range('2025-01-01', '2025-12-31 23:00', freq='1h', tz=TZ)
solpos = pvlib.solarposition.get_solarposition(idx, LAT, LON, altitude=3500)
clear = loc.get_clearsky(idx, model='ineichen')

# Representative fixed-roof production reference: south-facing 25 degree tilt.
poa = pvlib.irradiance.get_total_irradiance(
    surface_tilt=25,
    surface_azimuth=180,
    solar_zenith=solpos['apparent_zenith'],
    solar_azimuth=solpos['azimuth'],
    dni=clear['dni'], ghi=clear['ghi'], dhi=clear['dhi']
)
monthly = poa['poa_global'].groupby(poa.index.month).sum()
# kWh/kW/year under a conservative performance ratio.
yield_kwh_kw = float(monthly.sum() / 1000 * 0.80)

payload = {
    'source': 'pvlib-python clear-sky + solar-position build-time model',
    'location': {'lat': LAT, 'lon': LON, 'timezone': TZ, 'altitude_m': 3500},
    'annual_reference_yield_kwh_per_kw': round(yield_kwh_kw),
    'monthly_poa_kwh_m2': [round(float(monthly.get(i, 0) / 1000), 1) for i in range(1, 13)],
}
(OUT / 'solar-model-reference.json').write_text(json.dumps(payload, indent=2))
print(json.dumps(payload, indent=2))
