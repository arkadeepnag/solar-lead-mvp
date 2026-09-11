import React, {useEffect, useMemo, useRef, useState} from 'react';
import {createRoot} from 'react-dom/client';
import * as maplibregl from 'maplibre-gl';
import {setWorkerUrl} from 'maplibre-gl';
import workerUrl from 'maplibre-gl/dist/maplibre-gl-worker.mjs?worker&url';
import 'maplibre-gl/dist/maplibre-gl.css';

setWorkerUrl(workerUrl);
import {area, centroid, transformTranslate} from '@turf/turf';
import * as SunCalc from 'suncalc';
import './styles.css';

const fmtINR=n=>new Intl.NumberFormat('en-IN',{style:'currency',currency:'INR',maximumFractionDigits:0}).format(n||0);
const clamp=(n,a,b)=>Math.max(a,Math.min(b,n));
const emi=(principal,annual,months)=>{const r=annual/1200;return r?principal*r*Math.pow(1+r,months)/(Math.pow(1+r,months)-1):principal/months};
function irr(cash){let lo=-.9,hi=1.2;for(let i=0;i<80;i++){const r=(lo+hi)/2;let npv=cash[0];for(let y=1;y<cash.length;y++)npv+=cash[y]/Math.pow(1+r,y);if(npv>0)lo=r;else hi=r}return (lo+hi)/2}
function sunPosition(hour){const d=new Date();d.setHours(Math.floor(hour),Math.round((hour%1)*60),0,0);const p=SunCalc.getPosition(d,34.165,77.585);return {az:Math.round((p.azimuth*180/Math.PI+180+360)%360),el:Math.round(Math.max(0,p.altitude*180/Math.PI))}}
function band(prop,credit){if(prop>=75&&credit>=70)return ['FUNDABLE HOT','good'];if(prop>=75&&credit<70)return ['HOT / CREDIT RISK','risk'];if(prop<75&&credit>=70)return ['CREDIT FIT / LOW PROP','watch'];return ['LOW PRIORITY','low']}
function seeded01(value){let h=2166136261;for(const ch of String(value??'')){h^=ch.charCodeAt(0);h=Math.imul(h,16777619)}h+=(h<<13);h^=h>>>7;h+=h<<3;h^=h>>>17;h+=h<<5;return ((h>>>0)%10000)/10000}
function calcLead(p,target){
  const factor=target==='Residential'?0.86:1;
  const system=Math.max(.8,p.kw*factor);
  const subsidy=target==='Residential'?Math.min(78000,30000*Math.min(2,system)+18000*Math.max(0,Math.min(1,system-2))):0;
  const capex=system*(target==='Residential'?52000:47000); const netCapex=Math.max(0,capex-subsidy);
  const tariff=target==='Residential'?7.4:p.tariff;
  const usable=Math.max(0,p.usableArea || p.roofArea*.72);
  const orientationFactor=clamp(1-Math.abs((p.orientation||180)-180)/360,.72,1);
  const solarYield=(p.solar||5.1)*365*0.78*orientationFactor*(1-(p.shade||0)/100);
  const annualGen=Math.max(0,system*solarYield);
  const annualSave=annualGen*tariff;
  const loan=netCapex*.75; const e=emi(loan,target==='Residential'?9.5:10.5,84); const netMonthly=annualSave/12-e;
  const cash=[-netCapex];for(let y=1;y<=20;y++)cash.push(annualSave*Math.pow(.995,y)-capex*.012);
  const seed=seeded01(p.id||p.osm_id||p.name);
  const roofSignal=clamp(Math.log10(Math.max(40,p.roofArea||p.usableArea||100))*18,28,65);
  const solarSignal=clamp(((p.solar||5)-4.0)*13,0,22);
  const shadePenalty=clamp((p.shade||0)*.45,0,25);
  const economicsSignal=clamp((annualSave/120000)*8,0,14);
  const propensity=clamp(Math.round(roofSignal+solarSignal+economicsSignal-shadePenalty+(seed-.5)*22+(target==='C&I'?4:0)),8,98);
  const vintageSignal=clamp(((p.vintage||2018)-2005)*1.8,0,23);
  const affordability=clamp((p.bill||0)/10000,0,18);
  const loadSignal=clamp((p.load||0)/4,0,18);
  const credit=clamp(Math.round(35+vintageSignal+affordability+loadSignal-shadePenalty*.25+(seed-.5)*30+(target==='C&I'?3:0)),8,97);
  return {...p,system:+system.toFixed(1),subsidy,capex,netCapex,annualGen:Math.round(annualGen),annualSave:Math.round(annualSave),emi:Math.round(e),netMonthly:Math.round(netMonthly),payback:+(netCapex/Math.max(annualSave,1)).toFixed(2),irr:+(irr(cash)*100).toFixed(1),propensity,credit,usableCalc:+usable.toFixed(0),orientationFactor:+orientationFactor.toFixed(2),target,scoreSignals:{roof:Math.round(roofSignal),solar:Math.round(solarSignal),shade:Math.round(shadePenalty),economics:Math.round(economicsSignal),vintage:Math.round(vintageSignal),affordability:Math.round(affordability),load:Math.round(loadSignal)},band:band(propensity,credit)};
}

function DualAxis({leads,selected,target}){
  const scored=useMemo(()=>leads.map(p=>calcLead(p,target)),[leads,target]);
  const selectedLead=scored.find(x=>x.id===selected);
  const counts={
    hot:scored.filter(p=>p.propensity>=75&&p.credit>=70).length,
    risk:scored.filter(p=>p.propensity>=75&&p.credit<70).length,
    fit:scored.filter(p=>p.propensity<75&&p.credit>=70).length,
    low:scored.filter(p=>p.propensity<75&&p.credit<70).length
  };
  const maxPoints=Math.min(scored.length,900);
  const points=scored.slice(0,maxPoints);
  const xTicks=[0,20,40,60,80,100], yTicks=[0,20,40,60,80,100];
  return <section className="axisCard">
    <div className="axisHead">
      <div><b>DUAL-AXIS LEAD SCORE</b><span>Every point is one discovered rooftop. X = conversion propensity · Y = credit eligibility · point size = estimated solar kW.</span></div>
      <div className="axisLegend"><span><i className="legendDot green"/>Fundable hot</span><span><i className="legendDot amber"/>Credit risk</span><span><i className="legendDot slate"/>Credit fit</span></div>
    </div>
    <div className="axisBody">
      <div className="scatterShell">
        <div className="plotTopLabel">HIGH CREDIT ELIGIBILITY</div>
        <div className="plotZone zoneRisk"><b>HOT / CREDIT RISK</b><span>high intent · underwriting required</span></div>
        <div className="plotZone zoneHot"><b>FUNDABLE HOT</b><span>sales + credit gate passed</span></div>
        <div className="plotZone zoneLow"><b>LOW PRIORITY</b><span>low intent · low eligibility</span></div>
        <div className="plotZone zoneFit"><b>CREDIT FIT / LOW PROPENSITY</b><span>nurture / assisted conversion</span></div>
        <div className="plotGrid"/>
        <svg className="scorePlot" viewBox="0 0 100 100" preserveAspectRatio="none" aria-label="Conversion propensity versus credit eligibility">
          {points.map(p=>{const r=clamp(1.6+Math.sqrt(Math.max(1,p.kw||1))*.34,1.8,5.6);return <circle key={p.id} cx={p.propensity} cy={100-p.credit} r={r/1.35} className={`scorePoint ${p.band[1]} ${p.id===selected?'chosen':''}`} onClick={()=>document.querySelector(`[data-lead-id="${p.id}"]`)?.click()}><title>{`${p.name} · propensity ${p.propensity} · credit ${p.credit} · ${p.system||p.kw} kW`}</title></circle>})}
        </svg>
        <div className="thresholdV"/><div className="thresholdH"/>
        <div className="xTicks">{xTicks.map(t=><span key={t} style={{left:`${t}%`}}>{t}</span>)}</div>
        <div className="yTicks">{yTicks.map(t=><span key={t} style={{bottom:`${t}%`}}>{t}</span>)}</div>
        <div className="xAxis">CONVERSION PROPENSITY →</div>
        <div className="yAxis">CREDIT ELIGIBILITY ↑</div>
      </div>
      <div className="axisStats">
        <div className="axisStat hot"><small>FUNDABLE HOT</small><strong>{counts.hot}</strong><span>propensity ≥ 75 · credit ≥ 70</span></div>
        <div className="axisStat risk"><small>HOT / CREDIT RISK</small><strong>{counts.risk}</strong><span>propensity ≥ 75 · credit &lt; 70</span></div>
        <div className="axisStat fit"><small>CREDIT FIT</small><strong>{counts.fit}</strong><span>credit ≥ 70 · lower intent</span></div>
        <div className="axisStat low"><small>LOW PRIORITY</small><strong>{counts.low}</strong><span>both signals below gate</span></div>
        {selectedLead&&<div className="selectedAxis"><div><small>SELECTED ROOFTOP</small><strong>{selectedLead.propensity} <em>/</em> {selectedLead.credit}</strong><span>{selectedLead.band[0]} · {selectedLead.system||selectedLead.kw} kW</span></div><div className="selectedMeta"><span>PROPENSITY</span><b>{selectedLead.propensity}</b><span>CREDIT</span><b>{selectedLead.credit}</b></div></div>}
      </div>
    </div>
    <div className="axisFooter"><span><b>{scored.length.toLocaleString()}</b> live scored rooftops</span><span><b>{maxPoints}</b> plotted for interaction</span><span>Gate: <b>75 propensity / 70 credit</b></span><span>Score inputs include roof economics, solar/shade, load, bill and vintage proxies.</span></div>
  </section>
}
const OVERPASS_ENDPOINTS=['https://overpass.private.coffee/api/interpreter','https://overpass-api.de/api/interpreter','https://maps.mail.ru/osm/tools/overpass/api/interpreter'];
function parseHeight(v,levels=0){
  const n=parseFloat(String(v??'').replace(/[^0-9.\-]/g,''));
  if(Number.isFinite(n)&&n>0)return n;
  const l=parseFloat(String(levels??'').replace(/[^0-9.\-]/g,''));
  if(Number.isFinite(l)&&l>0)return Math.max(3,l*3.15);
  return 7.0;
}
function osmWayToFeature(el){
  if(!el.geometry||el.geometry.length<4)return null;
  const ring=el.geometry.map(n=>[n.lon,n.lat]);
  const first=ring[0],last=ring[ring.length-1];
  if(first[0]!==last[0]||first[1]!==last[1])ring.push(first);
  return {type:'Feature',id:`way/${el.id}`,properties:{...el.tags,osm_id:el.id,osm_type:'way',height_m:parseHeight(el.tags?.height,el.tags?.['building:levels'])},geometry:{type:'Polygon',coordinates:[ring]}};
}
function osmElementsToGeoJSON(elements){return {type:'FeatureCollection',features:elements.map(osmWayToFeature).filter(Boolean)};}
async function overpassQuery(query,{timeoutMs=14000}={}){
  let last;
  for(const endpoint of OVERPASS_ENDPOINTS){
    const controller=new AbortController();
    const timer=setTimeout(()=>controller.abort(),timeoutMs);
    try{
      const r=await fetch(endpoint,{method:'POST',headers:{'Content-Type':'application/x-www-form-urlencoded;charset=UTF-8'},body:'data='+encodeURIComponent(query),signal:controller.signal});
      if(!r.ok)throw new Error(`${r.status} ${r.statusText}`);
      const json=await r.json();
      return json.elements||[];
    }catch(e){last=e;}
    finally{clearTimeout(timer);}
  }
  throw last||new Error('Overpass unavailable');
}
function bboxForMap(map){const b=map.getBounds();return [b.getSouth(),b.getWest(),b.getNorth(),b.getEast()].map(v=>Number(v.toFixed(5)));}
async function fetchLehBuildings(map){
  const [south,west,north,east]=bboxForMap(map);
  // Keep the live query deliberately small. Buildings are the critical path for 3D;
  // parcel boundaries are a best-effort second request so a slow cadastral query can
  // never block the building scene.
  const buildingQuery=`[out:json][timeout:18];way[building](${south},${west},${north},${east});out geom qt;`;
  const buildingElements=await overpassQuery(buildingQuery,{timeoutMs:12000});
  const parcelQuery=`[out:json][timeout:12];way[boundary=parcel](${south},${west},${north},${east});out geom qt;`;
  let parcelElements=[];
  try{parcelElements=await overpassQuery(parcelQuery,{timeoutMs:8000});}catch{}
  const buildings={type:'FeatureCollection',features:buildingElements.map(osmWayToFeature).filter(Boolean)};
  const parcels={type:'FeatureCollection',features:parcelElements.map(osmWayToFeature).filter(Boolean)};
  return {buildings,parcels};
}

function osmLeadFromFeature(f,heatPoints=[]){
  const props=f.properties||{}; const a=Math.max(30,Math.round(area(f))); const usable=Math.round(a*.72); const kw=Math.max(.8,+(usable/5.8).toFixed(1));
  const c=centroid(f).geometry.coordinates; let solar=5.0,shade=18;
  if(heatPoints.length){let best=heatPoints[0],bd=1e9;for(const p of heatPoints){const d=(p[0]-c[1])**2+(p[1]-c[0])**2;if(d<bd){bd=d;best=p}} solar=best[3]||solar; shade=best[4]||shade;}
  const levels=Number(props['building:levels']||0); const height=Number(props.height||0); const vintage=props.start_date?Number(String(props.start_date).slice(0,4)):2018;
  const commercial=['industrial','warehouse','retail','commercial','office','hotel','school','hospital','university'].includes(props.building);
  const propensity=clamp(Math.round(54+Math.min(25,kw*.45)+(commercial?13:5)+(solar-4.5)*14-shade*.18),15,97);
  const credit=clamp(Math.round(62+(commercial?10:2)+(kw>30?8:0)-(vintage<2012?8:0)-shade*.08),20,96);
  return {id:`OSM-${props.osm_id}`,name:props.name||props.operator||`${commercial?'Commercial':'Residential'} building ${props.osm_id}`,address:props['addr:street']?`${props['addr:housenumber']||''} ${props['addr:street']}, Leh`.trim():'Leh, Ladakh',roofArea:a,usableArea:usable,kw,tariff:commercial?10.4:7.4,solar,shade,orientation:180,vintage,load:Math.round(kw*1.35),bill:Math.round(kw*1.35*900),propensity,credit,segment:commercial?'C&I':'Residential',osm_id:props.osm_id,height_m:height||Math.max(4.5,levels?levels*3.1:6.5),building_levels:levels||'—',building_type:props.building||'yes',discom:'Ladakh Power Development Department (LPDD)',sanctionedKVA:Math.max(5,Math.round((kw*1.25)/5)*5),tariffCategory:(commercial?(kw>=50?'LTIS-I / Industrial':'Non-Domestic Commercial'):'Domestic'),lpddRateRef:commercial?(kw>=50?5.46:8.01):7.39,lpddFixedRef:commercial?(kw>=50?90.26:190.26):null,centroid:c};
}

function shadowFeatureFromBuilding(f, hour){
  const props=f.properties||{};
  const height=parseHeight(props.height_m ?? props.height, props['building:levels']);
  const pos=sunPosition(hour);
  const elevation=Math.max(5,pos.el);
  const length=Math.min(160,Math.max(2,height/Math.tan(elevation*Math.PI/180)));
  const bearing=(pos.az+180)%360;
  const shifted=transformTranslate(f,length,bearing,{units:'meters'});
  shifted.properties={osm_id:props.osm_id,height_m:height,shadow_m:+length.toFixed(1)};
  return shifted;
}
function makeShadowCollection(buildings,hour){
  return {type:'FeatureCollection',features:buildings.features.map(f=>shadowFeatureFromBuilding(f,hour)).filter(Boolean)};
}

function enrichParcelMassing(parcels,buildings){
  const bcentroids=(buildings.features||[]).map(f=>({f,c:centroid(f).geometry.coordinates,h:parseHeight(f.properties?.height_m||f.properties?.height,f.properties?.['building:levels'])}));
  return {type:'FeatureCollection',features:(parcels.features||[]).map(f=>{
    const c=centroid(f).geometry.coordinates; let best=3.0,bd=Infinity;
    for(const b of bcentroids){const d=(b.c[0]-c[0])**2+(b.c[1]-c[1])**2;if(d<bd){bd=d;best=b.h;}}
    return {...f,properties:{...f.properties,height_m:bd<0.00012?Math.max(1.2,Math.min(best,30)):1.2}};
  })};
}
function MapPanel({selected,setSelected,setLeads,heatMode,setHeatMode,sunHour,setSunHour}){
 const ref=useRef(null),mapRef=useRef(null),parcelData=useRef(null),heatData=useRef(null),solarGridData=useRef(null),buildingsData=useRef(null);
 const [parcelStats,setParcelStats]=useState({count:0,area:0}),[view3d,setView3d]=useState(false),[heatVisible,setHeatVisible]=useState(true),[zoomLevel,setZoomLevel]=useState(14.2),[osmState,setOsmState]=useState('loading');
 const view3dRef=useRef(false),heatVisibleRef=useRef(true),fetchSeqRef=useRef(0),liveBuildingsRef=useRef(false),destroyedRef=useRef(false);
 view3dRef.current=view3d; heatVisibleRef.current=heatVisible;
 const makeHeatFeatures=(pts,mode,hour)=>({type:'FeatureCollection',features:pts.map((p,i)=>{
   let v=p[2];
   if(mode==='shade') v=clamp((p[4]/100)*(0.35+0.65*Math.max(.05,Math.sin(Math.PI*((hour-6)/12)))),.02,.98);
   if(mode==='weather') v=clamp((1-(p[4]/150))*((p[2]*.78)+.22),.02,1);
   if(mode==='kW') v=clamp(p[2]*.96,.02,1);
   const sun=sunPosition(hour); const solarAngle=clamp(sun.el/75,.1,1);
   v=clamp(v*(.72+.28*solarAngle),.01,1);
   return {type:'Feature',geometry:{type:'Point',coordinates:[p[1],p[0]]},properties:{value:v,solar:p[3],shade:p[4],mode,index:i}};
 })});
 const heatPaint={
   'heatmap-weight':['interpolate',['linear'],['get','value'],0,0,1,1],
   'heatmap-intensity':['interpolate',['linear'],['zoom'],10,.85,12,1.1,14,1.45,16,1.8,18,2.1],
   'heatmap-radius':['interpolate',['linear'],['zoom'],10,20,12,30,14,42,16,58,18,76],
   'heatmap-opacity':['interpolate',['linear'],['zoom'],10,.86,13,.82,15,.74,17,.64],
   'heatmap-color':['interpolate',['linear'],['heatmap-density'],0,'rgba(255,255,255,0)',.12,'rgba(224,245,187,.18)',.28,'rgba(198,235,110,.42)',.48,'rgba(255,218,78,.64)',.68,'rgba(255,164,50,.78)',.84,'rgba(244,87,47,.88)',1,'rgba(218,42,42,.94)']
 };
 const applyHeat=()=>{const map=mapRef.current;if(!map||!heatData.current)return;const data=makeHeatFeatures(heatData.current,heatMode,sunHour);['solar-heat-ground','solar-heat-top'].forEach(id=>{if(map.getSource(id))map.getSource(id).setData(data)});};
 useEffect(()=>{
   if(mapRef.current)return;
   const map=new maplibregl.Map({container:ref.current,center:[77.585,34.165],zoom:14.2,pitch:0,bearing:0,maxPitch:68,attributionControl:false,style:'https://tiles.openfreemap.org/styles/positron'});
   mapRef.current=map;
   destroyedRef.current=false;
   const lehBounds=new maplibregl.LngLatBounds([77.50,34.10],[77.66,34.23]); map.setMaxBounds(lehBounds);
   map.addControl(new maplibregl.NavigationControl({visualizePitch:true}), 'bottom-right');
   map.addControl(new maplibregl.ScaleControl({maxWidth:100,unit:'metric'}),'bottom-left');
   map.addControl(new maplibregl.AttributionControl({compact:true}), 'bottom-right');
   map.on('load',async()=>{
     if(destroyedRef.current)return;
     // Build the visual stack immediately. Network extraction only fills the sources later.
     // This prevents a slow Overpass response from making 3D/cadastral appear broken.
     try{
       const firstSymbolId=(map.getStyle().layers||[]).find(layer=>layer.type==='symbol')?.id;
       const addLayer=layer=>firstSymbolId?map.addLayer(layer,firstSymbolId):map.addLayer(layer);
       const empty={type:'FeatureCollection',features:[]};
       const emptyHeat=makeHeatFeatures([],heatMode,sunHour);
       const ensureSource=(id,source)=>{if(!map.getSource(id))map.addSource(id,source)};
       const ensureLayer=layer=>{if(!map.getLayer(layer.id))addLayer(layer)};

       ensureSource('solar-heat-ground',{type:'geojson',data:emptyHeat});
       ensureSource('solar-heat-top',{type:'geojson',data:emptyHeat});
       ensureSource('buildings-local',{type:'geojson',data:empty});
       ensureSource('building-shadows',{type:'geojson',data:empty});
       ensureSource('cadastral',{type:'geojson',data:empty,promoteId:'osm_id'});

       // OpenFreeMap's Positron style is backed by OpenMapTiles. Its building
       // vector layer is already real OSM geometry and gives Prabha a reliable
       // 3D scene even when Overpass is unavailable. Overpass is still used for
       // richer roof/cadastral intelligence when it responds.
       const styleBuilding=(map.getStyle().layers||[]).find(l=>l['source-layer']==='building' && l.source);
       const vectorBuildingSource=styleBuilding?.source;
       const hasVectorBuildings=!!vectorBuildingSource;
       if(hasVectorBuildings){
         ensureLayer({id:'vector-building-3d',type:'fill-extrusion',source:vectorBuildingSource,'source-layer':'building',minzoom:12,filter:['!=',['get','hide_3d'],true],paint:{
           'fill-extrusion-color':['interpolate',['linear'],['coalesce',['get','render_height'],['get','height'],7],0,'#dce4df',7,'#c2cec7',15,'#aab8b0',30,'#8d9c94',60,'#788981'],
           'fill-extrusion-height':['max',['coalesce',['get','render_height'],['get','height'],7],2.5],
           'fill-extrusion-base':['coalesce',['get','render_min_height'],0],
           'fill-extrusion-opacity':.94,
           'fill-extrusion-vertical-gradient':true
         }});
         ensureLayer({id:'vector-building-outline',type:'line',source:vectorBuildingSource,'source-layer':'building',minzoom:12,filter:['!=',['get','hide_3d'],true],paint:{'line-color':'#53625b','line-width':['interpolate',['linear'],['zoom'],12,.4,15,.7,18,1.1],'line-opacity':.78}});
       }

       ensureLayer({id:'solar-heat-ground',type:'heatmap',source:'solar-heat-ground',maxzoom:19,paint:heatPaint});
       ensureLayer({id:'building-shadows',type:'fill',source:'building-shadows',paint:{'fill-color':'#3e4944','fill-opacity':.18,'fill-outline-color':'#3e4944'}});
       ensureLayer({id:'building-2d',type:'fill',source:'buildings-local',paint:{'fill-color':'#ffffff','fill-opacity':.30,'fill-outline-color':'#647169'}});
       ensureLayer({id:'building-3d',type:'fill-extrusion',source:'buildings-local',minzoom:11,paint:{
         'fill-extrusion-color':['interpolate',['linear'],['coalesce',['get','height_m'],7],0,'#dce4df',7,'#c2cec7',15,'#aab8b0',30,'#8d9c94',60,'#788981'],
         'fill-extrusion-height':['max',['coalesce',['get','height_m'],7],2.5],
         'fill-extrusion-base':0,
         'fill-extrusion-opacity':.96,
         'fill-extrusion-vertical-gradient':true
       }});
       ensureLayer({id:'building-outline',type:'line',source:'buildings-local',paint:{'line-color':'#53625b','line-width':['interpolate',['linear'],['zoom'],12,.45,15,.8,18,1.2],'line-opacity':.78}});
       ensureLayer({id:'solar-heat-top',type:'heatmap',source:'solar-heat-top',maxzoom:19,paint:{...heatPaint,'heatmap-opacity':['interpolate',['linear'],['zoom'],10,.46,13,.40,15,.32,17,.24]}});
       ensureLayer({id:'cadastral-3d',type:'fill-extrusion',source:'cadastral',minzoom:11,paint:{
         'fill-extrusion-color':['case',['boolean',['feature-state','selected'],false],'#b7e83f','#c9d5ce'],
         'fill-extrusion-height':['case',['boolean',['feature-state','selected'],false],1.8,.65],
         'fill-extrusion-base':0,
         'fill-extrusion-opacity':['case',['boolean',['feature-state','selected'],false],.58,.10],
         'fill-extrusion-vertical-gradient':false
       }});
       ensureLayer({id:'cadastral-fill',type:'fill',source:'cadastral',paint:{
         'fill-color':['case',['boolean',['feature-state','selected'],false],'#b7e83f','#dbe5df'],
         'fill-opacity':['case',['boolean',['feature-state','selected'],false],.20,.045]
       }});
       ensureLayer({id:'cadastral-outline',type:'line',source:'cadastral',paint:{
         'line-color':['case',['boolean',['feature-state','selected'],false],'#5d8b0b','#596961'],
         'line-width':['case',['boolean',['feature-state','selected'],false],3.4,['interpolate',['linear'],['zoom'],11,.9,14,1.5,17,2.2,19,2.8]],
         'line-opacity':['case',['boolean',['feature-state','selected'],false],1,.92]
       }});

       // Heat is a ground field, not a roof/facade overlay. Put it below every
       // extrusion so 3D buildings stay visually intact.
       if(map.getLayer('vector-building-3d'))map.moveLayer('solar-heat-ground','vector-building-3d');
       else if(map.getLayer('building-3d'))map.moveLayer('solar-heat-ground','building-3d');

       // Always keep the parcel/roof boundary above the 3D surfaces. This is what the
       // previous version lost visually when a parcel was covered by an extrusion.
       const syncVisualState=()=>{
         if(!map.isStyleLoaded())return;
         const is3d=view3dRef.current,heatOn=heatVisibleRef.current;
         const visible=(id,on)=>{if(map.getLayer(id))map.setLayoutProperty(id,'visibility',on?'visible':'none')};
         visible('solar-heat-ground',heatOn);
         visible('solar-heat-top',heatOn&&!is3d);
         visible('building-2d',!is3d);
         visible('building-3d',is3d && liveBuildingsRef.current);
         visible('building-outline',is3d && liveBuildingsRef.current);
         visible('vector-building-3d',is3d && !liveBuildingsRef.current);
         visible('vector-building-outline',is3d && !liveBuildingsRef.current);
         visible('cadastral-3d',is3d && liveBuildingsRef.current);
         visible('cadastral-fill',true);
         visible('cadastral-outline',true);
         visible('building-shadows',true);
         if(map.getLayer('building-3d'))map.setPaintProperty('building-3d','fill-extrusion-opacity',is3d?.96:0);
         if(map.getLayer('cadastral-3d'))map.setPaintProperty('cadastral-3d','fill-extrusion-opacity',is3d?.20:.0);
         if(map.getLayer('building-shadows'))map.setPaintProperty('building-shadows','fill-opacity',is3d?.28:.14);
         if(map.getLayer('solar-heat-ground'))map.setPaintProperty('solar-heat-ground','heatmap-opacity',is3d?.48:.78);
         if(map.getLayer('solar-heat-top'))map.setPaintProperty('solar-heat-top','heatmap-opacity',is3d?0:.28);
       };
       map.__prabhaSync=syncVisualState;
       map.__prabhaVectorShadows=()=>{
         if(liveBuildingsRef.current || !map.getLayer('vector-building-3d') || !map.getSource('building-shadows'))return;
         try{
           const features=map.queryRenderedFeatures({layers:['vector-building-3d']});
           const seen=new Set();
           const unique=features.filter(f=>{const id=String(f.properties?.osm_id ?? f.id ?? JSON.stringify(f.geometry?.coordinates?.[0]?.[0]||''));if(seen.has(id))return false;seen.add(id);return true;});
           map.getSource('building-shadows').setData(makeShadowCollection({type:'FeatureCollection',features:unique},sunHour));
         }catch{}
       };

       // Solar grid is local/modelled; live roof geometry comes from Overpass.

       const pts=await fetch('/data/leh-solar-grid.json').then(r=>{if(!r.ok)throw new Error('Solar grid unavailable');return r.json()});
       solarGridData.current=pts; heatData.current=pts;
       const [south,west,north,east]=bboxForMap(map);
       const query=`[out:json][timeout:45];(way[building](${south},${west},${north},${east});way[boundary=parcel](${south},${west},${north},${east}););out geom;`;
       const requestId=++fetchSeqRef.current;
       const elements=await overpassQuery(query);
       if(destroyedRef.current || requestId!==fetchSeqRef.current || mapRef.current!==map)return;
       const all=osmElementsToGeoJSON(elements);
       const buildings={type:'FeatureCollection',features:all.features.filter(f=>f.properties.building).map(f=>({...f,properties:{...f.properties,height_m:parseHeight(f.properties.height,f.properties['building:levels'])}}))};
       buildingsData.current=buildings;
       liveBuildingsRef.current=buildings.features.length>0;
       const osmParcels={type:'FeatureCollection',features:all.features.filter(f=>f.properties.boundary==='parcel')};
       const enrichedParcels=enrichParcelMassing(osmParcels,buildings);
       const sourceFeatures=enrichedParcels.features.length?enrichedParcels.features:buildings.features.map(f=>({...f,properties:{...f.properties,parcel_proxy:true}}));
       const sourceData={type:'FeatureCollection',features:sourceFeatures};
       parcelData.current=sourceData;
       const leads=buildings.features.map(f=>osmLeadFromFeature(f,pts));
       const roofHeat=buildings.features.map(f=>{const l=osmLeadFromFeature(f,pts);return [l.centroid[1],l.centroid[0],clamp((l.solar-4.0)/2.0,.08,1),l.solar,l.shade]});
       heatData.current=pts.concat(roofHeat);
       if(map.getSource('solar-heat-ground'))map.getSource('solar-heat-ground').setData(makeHeatFeatures(heatData.current,heatMode,sunHour));
       if(map.getSource('solar-heat-top'))map.getSource('solar-heat-top').setData(makeHeatFeatures(heatData.current,heatMode,sunHour));
       if(map.getSource('buildings-local'))map.getSource('buildings-local').setData(buildings);
       if(map.getSource('building-shadows'))map.getSource('building-shadows').setData(makeShadowCollection(buildings,sunHour));
       if(map.getSource('cadastral'))map.getSource('cadastral').setData(sourceData);
       setLeads(leads);if(leads[0])setSelected(leads[0].id);
       const total=sourceFeatures.reduce((sum,f)=>sum+area(f),0);
       setParcelStats({count:sourceFeatures.length,area:Math.round(total),live:true,buildings:buildings.features.length,official:osmParcels.features.length});
       setOsmState('live');

       const bounds=new maplibregl.LngLatBounds();
       buildings.features.forEach(f=>(f.geometry.coordinates[0]||[]).forEach(c=>bounds.extend(c)));
       if(!bounds.isEmpty())map.fitBounds(bounds,{padding:{top:100,bottom:120,left:35,right:35},duration:0,maxZoom:15});
       syncVisualState();
       map.resize();
       map.__prabhaVectorShadows?.();
     }catch(e){
       console.error('Prabha live extraction error',e);
       setOsmState('error');
       liveBuildingsRef.current=false;
       // Keep the map and all controls alive even if Overpass is unavailable.
       // The empty sources remain valid, so 3D/cadastral do not crash or disappear.
       const map=mapRef.current;
       if(map?.__prabhaSync)map.__prabhaSync();
       map?.__prabhaVectorShadows?.();
     }
   });
   map.on('zoom',()=>setZoomLevel(map.getZoom()));
   map.on('click','cadastral-outline',(e)=>{
     const f=e.features?.[0];if(!f)return;const p=f.properties;const m=centroid(f).geometry.coordinates;const measured=Math.round(area(f));
     const lead=osmLeadFromFeature(f,heatData.current||[]); setLeads(prev=>prev.some(x=>x.id===lead.id)?prev:[lead,...prev]); setSelected(lead.id);
     new maplibregl.Popup({closeButton:true,offset:14,maxWidth:'350px'}).setLngLat(e.lngLat).setHTML(`<div class="mapPopup"><div class="popupKicker">LIVE OSM ROOFTOP EXTRACTION</div><h3>${lead.name}</h3><p>${lead.address}</p><div class="popupGrid"><b>${lead.kw} kW</b><span>derived from OSM footprint</span><b>${measured.toLocaleString()} m²</b><span>measured with Turf.js</span><b>${lead.propensity} / ${lead.credit}</b><span>propensity / credit</span><b>${lead.solar} kWh/m²/day</b><span>solar resource model</span></div><small>OSM way ${p.osm_id} · ${m[1].toFixed(5)}, ${m[0].toFixed(5)}</small></div>`).addTo(map);
   });
   map.on('click','building-3d',(e)=>{const p=e.features?.[0]?.properties||{};const h=parseHeight(p.height_m ?? p.height,p['building:levels']);const f=map.queryRenderedFeatures(e.point,{layers:['building-3d']})[0];const measured=f?Math.round(area(f)):0;new maplibregl.Popup({closeButton:true,offset:8,maxWidth:'300px'}).setLngLat(e.lngLat).setHTML(`<div class="mapPopup"><div class="popupKicker">LIVE OSM BUILDING</div><h3>${p.name||'OSM building'}</h3><p>Live OpenStreetMap footprint · MapLibre extrusion.</p><div class="popupGrid"><b>${h.toFixed(1)} m</b><span>height / inferred</span><b>${p['building:levels']||'—'}</b><span>OSM levels</span><b>${measured.toLocaleString()} m²</b><span>footprint area</span></div><small>OSM way ${p.osm_id||p.id||'—'}</small></div>`).addTo(map);});
   map.on('click','vector-building-3d',(e)=>{const p=e.features?.[0]?.properties||{};const h=Number(p.render_height||p.height||7);new maplibregl.Popup({closeButton:true,offset:8,maxWidth:'300px'}).setLngLat(e.lngLat).setHTML(`<div class="mapPopup"><div class="popupKicker">OPENMAPTILES · OSM BUILDING</div><h3>${p.name||'OSM building'}</h3><p>Live vector-tile building geometry. Overpass enrichment is unavailable right now.</p><div class="popupGrid"><b>${h.toFixed(1)} m</b><span>rendered height</span><b>${p.render_height||'—'}</b><span>OSM height model</span><b>${p.osm_id||'—'}</b><span>OSM id</span></div></div>`).addTo(map);});
   map.on('mouseenter','cadastral-outline',()=>map.getCanvas().style.cursor='pointer');map.on('mouseleave','cadastral-outline',()=>map.getCanvas().style.cursor='');
   map.on('mouseenter','building-3d',()=>map.getCanvas().style.cursor='crosshair');map.on('mouseleave','building-3d',()=>map.getCanvas().style.cursor='');map.on('mouseenter','vector-building-3d',()=>map.getCanvas().style.cursor='crosshair');map.on('mouseleave','vector-building-3d',()=>map.getCanvas().style.cursor='');
   let moveTimer;
   const refreshViewport=()=>{
     clearTimeout(moveTimer);
     moveTimer=setTimeout(async()=>{
       if(map.getZoom()<13)return;
       try{
         const requestId=++fetchSeqRef.current; const live=await fetchLehBuildings(map); if(destroyedRef.current || requestId!==fetchSeqRef.current || mapRef.current!==map)return; const buildings={type:'FeatureCollection',features:live.buildings.features.map(f=>({...f,properties:{...f.properties,height_m:parseHeight(f.properties.height,f.properties['building:levels'])}}))}; const parcels={type:'FeatureCollection',features:live.parcels.features}; const enrichedParcels=enrichParcelMassing(parcels,buildings); const sourceFeatures=enrichedParcels.features.length?enrichedParcels.features:buildings.features.map(f=>({...f,properties:{...f.properties,parcel_proxy:true}}));
         buildingsData.current=buildings;
       liveBuildingsRef.current=buildings.features.length>0; parcelData.current={type:'FeatureCollection',features:sourceFeatures};
         if(map.getSource('buildings-local'))map.getSource('buildings-local').setData(buildings);
         if(map.getSource('building-shadows'))map.getSource('building-shadows').setData(makeShadowCollection(buildings,sunHour));
         if(map.getSource('cadastral'))map.getSource('cadastral').setData(parcelData.current);
         const newLeads=buildings.features.map(f=>osmLeadFromFeature(f,solarGridData.current||[]));
         const roofHeat=buildings.features.map(f=>{const l=osmLeadFromFeature(f,solarGridData.current||[]); return [l.centroid[1],l.centroid[0],clamp((l.solar-4.0)/2.0,.08,1),l.solar,l.shade];});
         heatData.current=(solarGridData.current||[]).concat(roofHeat); setLeads(newLeads);
         setOsmState('live');
         setParcelStats(x=>({...x,count:sourceFeatures.length,buildings:buildings.features.length,official:parcels.features.length,live:true}));
       }catch(e){console.warn('OSM viewport refresh skipped',e);}
     },850);
   };
   map.on('moveend',refreshViewport);
   map.on('idle',()=>{if(!liveBuildingsRef.current)map.__prabhaVectorShadows?.()});
   return()=>{
     clearTimeout(moveTimer);
     destroyedRef.current=true;
     fetchSeqRef.current++;
     if(mapRef.current===map)mapRef.current=null;
     try{map.remove()}catch{}
   };
 },[]);
 useEffect(()=>{if(!mapRef.current||!parcelData.current)return;const map=mapRef.current;parcelData.current.features.forEach(f=>{try{map.setFeatureState({source:'cadastral',id:f.properties.osm_id},{selected:f.properties.osm_id===selected})}catch{}});const f=parcelData.current.features.find(x=>`OSM-${x.properties.osm_id}`===selected);if(f){const c=centroid(f).geometry.coordinates;map.easeTo({center:c,zoom:Math.max(map.getZoom(),15),duration:350});}},[selected]);
 useEffect(()=>{applyHeat(); const map=mapRef.current; if(map?.getSource('building-shadows')&&buildingsData.current){map.getSource('building-shadows').setData(makeShadowCollection(buildingsData.current,sunHour));}},[heatMode,sunHour]);
 useEffect(()=>{const map=mapRef.current;if(!map)return;const vis=heatVisible?'visible':'none';['solar-heat-ground'].forEach(id=>{if(map.getLayer(id))map.setLayoutProperty(id,'visibility',vis)});},[heatVisible]);
 useEffect(()=>{
   const map=mapRef.current;if(!map)return;
   const apply=()=>{
     const sync=map.__prabhaSync;
     if(sync)sync();
     map.resize();
     map.stop();
     // Use jumpTo for deterministic mode switching; setPitch can be ignored visually
     // during an active camera transition in some MapLibre/browser combinations.
     if(view3d)map.jumpTo({pitch:58,bearing:-22});
     else map.jumpTo({pitch:0,bearing:0});
     if(view3d){
       // A second frame makes the extrusion camera state deterministic after layout changes.
       requestAnimationFrame(()=>{if(mapRef.current===map){map.resize();map.setPitch(58);map.setBearing(-22);map.__prabhaVectorShadows?.()}});
     }
   };
   if(map.isStyleLoaded())apply(); else map.once('idle',apply);
 },[view3d,heatVisible]);
 const toggle3d=(next)=>{
   const v=typeof next==='boolean'?next:!view3d;
   setView3d(v);
   const m=mapRef.current;
   if(!m)return;
   const apply=()=>{
     m.stop();
     if(m.__prabhaSync)m.__prabhaSync();
     m.resize();
     if(v){m.jumpTo({pitch:60,bearing:-22});requestAnimationFrame(()=>{if(mapRef.current===m){m.resize();m.setPitch(60);m.setBearing(-22);m.__prabhaVectorShadows?.()}})}
     else m.jumpTo({pitch:0,bearing:0});
   };
   if(m.isStyleLoaded())apply(); else m.once('idle',apply);
 };
 const pos=sunPosition(sunHour);
 return <div className="mapWrap">
   <div className="map" ref={ref}/><div className={`mapLoad ${osmState==='live'?'done':osmState==='error'?'error':''}`}><span className="mapLoadDot"/><div><b>{osmState==='live'?'LIVE GEOMETRY READY':osmState==='error'?'LIVE EXTRACTION UNAVAILABLE':'LOADING LIVE GEOMETRY'}</b><small>{osmState==='live'?'3D buildings · parcel boundaries · solar model':osmState==='error'?'Map controls remain active · retry by moving the map':'Overpass building extraction is running'}</small></div></div>
   <div className="mapStats"><b>{parcelStats.count||0}</b><span>{parcelStats.official?'OSM parcels':(osmState==='error'?'OSM vector':'OSM roofs')}</span><b>{parcelStats.buildings||0}</b><span>buildings</span><b>{view3d?'3D':'2D'}</b><span>{view3d?'massing':'heat'}</span></div>
   <div className="mapToolbar"><button className={view3d?'':'active'} onClick={()=>toggle3d(false)}>2D · HEAT</button><button className={view3d?'active':''} onClick={()=>toggle3d(true)}>3D · MASSING</button><button onClick={()=>{toggle3d(true); if(selected){const f=(parcelData.current?.features||[]).find(x=>`OSM-${x.properties.osm_id}`===selected)||(buildingsData.current?.features||[]).find(x=>`OSM-${x.properties.osm_id}`===selected); if(f){const c=centroid(f).geometry.coordinates; mapRef.current?.easeTo({center:c,zoom:16,pitch:62,bearing:-22,duration:700});}}}}>FOCUS</button><button className={heatVisible?'active':''} onClick={()=>setHeatVisible(v=>!v)}>{heatVisible?'HEATMAP ON':'HEATMAP OFF'}</button><span className="shadowBadge">☀ shadows auto</span></div>
   <div className="mapControls"><div className="modeBtns">{['solar','shade','weather','kW'].map(x=><button key={x} className={heatMode===x?'active':''} onClick={()=>setHeatMode(x)}>{x==='kW'?'TAM kW':x[0].toUpperCase()+x.slice(1)}</button>)}</div><div className="sun"><span>☀</span><input aria-label="Sun time" type="range" min="6" max="18" step=".25" value={sunHour} onChange={e=>setSunHour(+e.target.value)}/><b>{sunHour.toFixed(2)}h</b><small>AZ {pos.az}° · EL {pos.el}° · SunCalc</small></div></div>
 </div>
}
function Spark({values}){const w=560,h=190,p={l:34,r:16,t:16,b:28},min=Math.min(...values),max=Math.max(...values),range=max-min||1;const points=values.map((v,i)=>{const x=p.l+i*(w-p.l-p.r)/(values.length-1);const y=p.t+(1-(v-min)/range)*(h-p.t-p.b);return [x,y,v]});const poly=points.map(([x,y])=>`${x},${y}`).join(' ');const areaPath=`M ${p.l} ${h-p.b} L ${points.map(([x,y])=>`${x} ${y}`).join(' L ')} L ${w-p.r} ${h-p.b} Z`;const ticks=[0,.25,.5,.75,1].map(t=>Math.round(min+(max-min)*t));return <svg className="spark" viewBox={`0 0 ${w} ${h}`} preserveAspectRatio="none"><defs><linearGradient id="solarArea" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stopColor="#a8d83c" stopOpacity=".26"/><stop offset="100%" stopColor="#a8d83c" stopOpacity="0"/></linearGradient></defs>{ticks.map((t,i)=>{const y=p.t+(1-i/4)*(h-p.t-p.b);return <g key={t}><line x1={p.l} x2={w-p.r} y1={y} y2={y} className="chartGrid"/><text x={p.l-7} y={y+3} textAnchor="end" className="chartAxis">{(t/1000).toFixed(0)}k</text></g>})}<path d={areaPath} fill="url(#solarArea)"/><polyline points={poly} fill="none" className="chartLine"/><line x1={p.l} x2={w-p.r} y1={h-p.b} y2={h-p.b} className="chartAxisLine"/>{points.map(([x,y,v],i)=><circle key={i} cx={x} cy={y} r="3.5" className="chartPoint"/>)}{["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"].map((m,i)=><text key={m} x={p.l+i*(w-p.l-p.r)/11} y={h-7} textAnchor={i===0?"start":i===11?"end":"middle"} className="chartAxis">{m}</text>)}</svg>}

function App(){
 const [leads,setLeads]=useState([]),[selected,setSelected]=useState(null),[tab,setTab]=useState('Discovery'),[target,setTarget]=useState('C&I'),[heatMode,setHeatMode]=useState('solar'),[sunHour,setSunHour]=useState(13.5),[wa,setWa]=useState(false),[scan,setScan]=useState(false),[waStep,setWaStep]=useState(0);
 useEffect(()=>{setLeads([])},[]);
 const filtered=useMemo(()=>leads.map(x=>calcLead(x,target)).filter(x=>target==='C&I'?x.kw>=20:true).sort((a,b)=>Math.min(b.propensity,b.credit)-Math.min(a.propensity,a.credit)).slice(0,10),[leads,target]);
 const raw=leads.find(x=>x.id===selected)||leads[0];const lead=raw?calcLead(raw,target):null;const sun=sunPosition(sunHour);
 useEffect(()=>{if(!wa)return; if(waStep>=6)return; const t=setTimeout(()=>setWaStep(v=>Math.min(6,v+1)),1200); return()=>clearTimeout(t);},[wa,waStep]);
 const runScan=()=>{setScan(true);setTimeout(()=>{setLeads(l=>[...l].sort((a,b)=>Math.min(calcLead(b,target).propensity,calcLead(b,target).credit)-Math.min(calcLead(a,target).propensity,calcLead(a,target).credit)));setScan(false)},600)};
 const exportList=()=>{const blob=new Blob([JSON.stringify(filtered,null,2)],{type:'application/json'});const a=document.createElement('a');a.href=URL.createObjectURL(blob);a.download='prabha-leh-shortlist.json';a.click();URL.revokeObjectURL(a.href)};
 const openWhatsApp=()=>{const text=`Prabha solar qualification for ${lead?.name||'your rooftop'}: ${lead?.system||'—'} kW indicative system, ${lead?.sanctionedKVA||'—'} kVA modeled sanctioned load, ${fmtINR(lead?.netMonthly||0)} monthly net savings after EMI. Reply YES to continue qualification.`;window.open('https://api.whatsapp.com/send?text='+encodeURIComponent(text),'_blank','noopener,noreferrer')};
 const season=[.72,.81,.94,1.06,1.17,1.24,1.21,1.11,.98,.86,.75,.68]; const months=season.map(v=>Math.round(v*(lead?.annualGen||0)/season.reduce((a,b)=>a+b,0)*12));
 return <div className="app"><header><div className="brand"><div className="logo">P</div><div><strong>Prabha</strong><small>ROOFTOP INTELLIGENCE</small></div></div><div className="territory"><b>LEH</b><span>India · Ladakh</span><em>{leads.length ? `${leads.length} OSM roofs live` : 'OSM roofs live'}</em></div><div className="headerStatus"><span className="statusDot"/>LEH · LIVE</div><div className="live"><i/>OSM EXTRACTION</div></header>
 <div className="body"><aside><div className="navtitle">PIPELINE</div>{['Discovery','Viability','Credit & offers','Partner routing','Learning'].map(t=><button key={t} className={tab===t?'on':''} onClick={()=>setTab(t)}><span>{t==='Discovery'?'◈':t==='Viability'?'◉':t==='Credit & offers'?'◌':t==='Partner routing'?'↗':'⌁'}</span>{t}</button>)}<div className="sideDivider"/><div className="navtitle">TARGET</div><div className="seg"><button className={target==='C&I'?'on':''} onClick={()=>setTarget('C&I')}>C&I</button><button className={target==='Residential'?'on':''} onClick={()=>setTarget('Residential')}>Residential</button></div><div className="source"><b>OPEN SOURCE STACK</b><span>MapLibre + live OSM footprints</span><span>Turf.js spatial measurement</span><span>SunCalc solar position</span><span>pvlib / PVWatts model reference</span><span>OSM + Overpass live extraction</span></div></aside>
 <main><div className="hero"><div><span className="eyebrow">{tab.toUpperCase()} / LEH</span><h1>{tab==='Discovery'?'Discover prospects before they raise a hand.':tab==='Viability'?'Prove the roof before a field visit.':tab==='Credit & offers'?'Underwrite the lead before dispatch.':tab==='Partner routing'?'Route only leads that can survive contact.':'Turn outcomes into better targeting.'}</h1><p>{tab==='Discovery'?'Build a ranked target universe from live OSM roof geometry, rooftop economics and business proxies.':'Every view is tied to the selected parcel and keeps conversion propensity separate from credit eligibility.'}</p></div><div className="actions"><button onClick={exportList}>⇩ Export shortlist</button><button className="primary" onClick={runScan}>{scan?'Scanning…':'Run territory scan ↗'}</button></div></div>
 <MapPanel selected={selected} setSelected={setSelected} setLeads={setLeads} heatMode={heatMode} setHeatMode={setHeatMode} sunHour={sunHour} setSunHour={setSunHour}/>
 {lead&&<section className="discomStrip"><div className="discomTitle"><b>DISCOM / KVA INTELLIGENCE</b><span>LPDD · Ladakh · selected live OSM roof</span></div><div><small>SANCTIONED / MODELED</small><strong>{lead.sanctionedKVA} kVA</strong></div><div><small>RECOMMENDED SOLAR</small><strong>{lead.system} kW</strong></div><div><small>TARIFF CLASS</small><strong>{lead.tariffCategory}</strong></div><div><small>ENERGY RATE REF.</small><strong>₹{lead.lpddRateRef}/kVAh</strong></div><div><small>DEMAND / FIXED REF.</small><strong>{lead.lpddFixedRef?`₹${lead.lpddFixedRef}/kVA/mo`:'—'}</strong></div></section>}
 <DualAxis leads={leads} selected={selected} target={target}/>
 <div className="contentGrid"><section className="rank"><div className="sectionHead"><div><b>Priority rooftops</b><span>{filtered.length} shown · rank = bottleneck gate, axes stay separate</span></div><span className="dispatchQ">DISPATCH QUEUE</span></div>{filtered.map((x,i)=>{const b=x.band;return <button data-lead-id={x.id} className={'leadRow '+(selected===x.id?'selected':'')} key={x.id} onClick={()=>{setSelected(x.id);setTab('Viability')}}><div className="rankNo">{String(i+1).padStart(2,'0')}</div><div className="leadMain"><strong>{x.name}</strong><small>{x.address}</small><div><span>{x.kw} kW</span><span>{Math.round(x.roofArea)} m² roof</span><span>₹{x.tariff}/kWh</span></div><em className={`bandPill ${b[1]}`}>{b[0]}</em></div><div className="scores"><label>PROP <b>{x.propensity}</b></label><i><em style={{width:`${x.propensity}%`}}/></i><label>CREDIT <b>{x.credit}</b></label><i className="credit"><em style={{width:`${x.credit}%`}}/></i></div></button>})}</section>
 <section className="detail">{lead&&<><div className="detailHead"><div><span className="badge">{lead.band[0]}</span><h2>{lead.name}</h2><p>{lead.address} · parcel {lead.id}</p></div><button className="dispatch" onClick={()=>{setWaStep(0);setWa(true)}}>QUALIFY ↗</button></div><div className="metrics"><div className="metric"><small>SYSTEM</small><strong>{lead.system} kW</strong><span>{Math.round(lead.usableCalc)} m² usable</span></div><div className="metric"><small>ANNUAL GENERATION</small><strong>{lead.annualGen.toLocaleString()} kWh</strong><span>{lead.solar} kWh/m²/day resource</span></div><div className="metric"><small>PAYBACK</small><strong>{lead.payback} yr</strong><span>IRR {lead.irr}%</span></div><div className="metric"><small>NET / MONTH</small><strong>{fmtINR(lead.netMonthly)}</strong><span>after indicative EMI</span></div></div><div className="discomCard"><div><small>DISCOM / UTILITY</small><strong>LPDD · Ladakh</strong><span>JERC FY26–27 tariff reference</span></div><div><small>SANCTIONED LOAD</small><strong>{lead.sanctionedKVA} kVA</strong><span>modeled from OSM roof demand proxy</span></div><div><small>TARIFF CATEGORY</small><strong>{lead.tariffCategory}</strong><span>{lead.lpddRateRef ? `₹${lead.lpddRateRef}/kVAh ref.` : 'domestic slab'}</span></div><div><small>DEMAND / FIXED</small><strong>{lead.lpddFixedRef ? `₹${lead.lpddFixedRef}/kVA/mo` : '—'}</strong><span>reference only</span></div></div><div className="scoregrid"><div><div className="scoreTitle"><span>CONVERSION PROPENSITY</span><b>{lead.propensity}</b></div><div className="bar"><i style={{width:`${lead.propensity}%`}}/></div><small>roof economics + business-fit signals</small></div><div><div className="scoreTitle"><span>CREDIT ELIGIBILITY</span><b className="orange">{lead.credit}</b></div><div className="bar orange"><i style={{width:`${lead.credit}%`}}/></div><small>load / bill / vintage / affordability proxy</small></div></div><div className="lower"><div className="analysis"><div className="cardHead"><b>Solar yield profile</b><span>modeled monthly kWh</span></div><Spark values={months}/><div className="months">{['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'].map(m=><span key={m}>{m[0]}</span>)}</div><div className="miniGrid"><div><small>SHADE</small><b>{lead.shade}%</b></div><div><small>AZIMUTH</small><b>{lead.orientation}°</b></div><div><small>TARIFF</small><b>₹{lead.tariff}</b></div><div><small>SUN</small><b>{sun.el}°</b></div></div></div><div className="offer"><div className="cardHead"><b>Instant offer</b><span>{target}</span></div><div className="offerBig">{fmtINR(lead.netMonthly)}<small>monthly savings after EMI</small></div><div className="offerLines"><span>System <b>{lead.system} kW</b></span><span>CAPEX <b>{fmtINR(lead.capex)}</b></span><span>Subsidy <b>{fmtINR(lead.subsidy)}</b></span><span>EMI <b>{fmtINR(lead.emi)}</b></span></div><button onClick={()=>{setWaStep(0);setWa(true)}}>START WHATSAPP QUALIFICATION</button></div></div></>}</section></div>
 <section className="workbench">{tab==='Discovery'&&<><div><b>OUTBOUND PROSPECT DISCOVERY</b><span>Live OSM footprint → roof area → business identity proxy → tariff → ranked address.</span></div><div className="flow"><i>OSM / Overpass</i><b>→</b><i>Footprint extraction</i><b>→</b><i>Turf area / centroid</i><b>→</b><i>Roof economics</i><b>→</b><i>Udyam · GST · MCA proxy</i><b>→</b><i>Dual-axis score</i></div><div className="statline"><b>{leads.length}</b><span>candidate roofs</span><b>{leads.filter(x=>x.propensity>=75).length}</b><span>high-propensity</span><b>{leads.filter(x=>x.credit>=70).length}</b><span>credit-ready</span></div></>}{tab==='Viability'&&<><div><b>SOLAR VIABILITY ENGINE</b><span>Usable roof × spatial solar resource × shade × orientation × tariff.</span></div><div className="viabilityBars"><span>Roof usable <i style={{width:`${clamp((lead?.usableCalc||0)/(lead?.roofArea||1)*100,0,100)}%`}}/></span><span>Solar resource <i style={{width:`${clamp(((lead?.solar||4.5)-4)*62,0,100)}%`}}/></span><span>Shade penalty <i className="orangeBar" style={{width:`${lead?.shade||0}%`}}/></span></div><div className="sunCard"><b>Sun geometry · SunCalc</b><span>{sun.az}° azimuth · {sun.el}° elevation · {sunHour.toFixed(2)}h</span><em>Heat field reweights continuously as the sun moves.</em></div></>}{tab==='Credit & offers'&&<><div><b>DUAL-AXIS UNDERWRITING</b><span>A hot roof is not a good lead if the financing gate fails.</span></div><div className="twoAxis"><div><small>CONVERSION</small><strong>{lead?.propensity}/100</strong><em>sales likelihood</em></div><div><small>CREDIT</small><strong className="orangeText">{lead?.credit}/100</strong><em>eligibility / affordability</em></div><div><small>EMI</small><strong>{fmtINR(lead?.emi)}</strong><em>84 month indicative</em></div><div><small>NET SAVING</small><strong>{fmtINR(lead?.netMonthly)}</strong><em>after EMI</em></div></div></>}{tab==='Partner routing'&&<><div><b>PARTNER ROUTING & LEAKAGE CONTROL</b><span>Route by pincode + capacity band and surface untouched leads.</span></div><div className="route"><div><b>RECOMMENDED EPC</b><strong>Himalayan Solar EPC · Leh</strong><span>194101 · 20–250 kW · SLA 2h</span></div><div><b>LEAD STATE</b><strong>{lead?.credit>=65?'Dispatch ready':'Credit review'}</strong><span>{lead?.band[0]}</span></div><div><b>LEAKAGE WATCH</b><strong>7 leads &gt; SLA</strong><span>3 high propensity · 2 credit ready</span></div></div></>}{tab==='Learning'&&<><div><b>CLOSED-LOOP LEARNING</b><span>Outcome labels update propensity and credit components; funded customers remain the KPI.</span></div><div className="learningFlow"><span>843 discovered</span><b>→</b><span>391 qualified</span><b>→</b><span>248 credit pass</span><b>→</b><span>127 dispatched</span><b>→</b><span>61 funded</span></div><div className="learningNote">Rejected for affordability lowers credit for similar bill/load patterns; quote drops lower conversion propensity for similar roof/tariff patterns.</div></>}</section>
 </main></div>{wa&&<div className="overlay"><div className="wa"><div className="waHead"><div><b>Prabha · WhatsApp qualification</b><small>{lead?.name}</small></div><button onClick={()=>setWa(false)}>×</button></div><div className="chat"><div className="waProgress"><i style={{width:`${Math.min(100,(waStep+1)/6*100)}%`}}/></div>{[
          ['Prabha','We found a rooftop opportunity from the live OSM roof map. Want a quick solar estimate?'],
          ['Prabha','Is the roof owned or rented?'],
          ['Customer','Owned.'],
          ['Prabha','What is the sanctioned load in kVA and your last 3 electricity bills?'],
          ['Customer','125 kVA. Bills: ₹1.2L, ₹1.1L, ₹1.3L.'],
          ['Prabha',`Please share a roof photo. After that, your indicative offer is ${lead?.system||'—'} kW with ${fmtINR(lead?.netMonthly||0)} monthly net savings.`],
          ['Prabha','Roof photo received ✓. Affordability gate passed → EPC dispatch ready.']
        ].slice(0,waStep+1).map((m,i)=><div key={i} className={`msg ${m[0]==='Customer'?'in':'out'}`}><small>{m[0]}</small>{m[1]}{m[0]==='Prabha'&&i>0?<em>✓✓</em>:null}</div>)}</div><div className="waFoot">{waStep<6?<span className="waAuto">AUTO-QUALIFYING · next step in 1.2s</span>:<div className="waFinal"><button onClick={openWhatsApp}>OPEN WHATSAPP ↗</button><button className="success" onClick={()=>setWa(false)}>QUALIFIED → EPC DISPATCH</button></div>}</div></div></div>}</div>
}
createRoot(document.getElementById('root')).render(<App/>);
