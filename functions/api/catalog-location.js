const clean=value=>String(value||"").trim();
const norm=value=>clean(value).normalize("NFD").replace(/[\u0300-\u036f]/g,"").toLowerCase().replace(/[^a-z0-9]+/g," ").trim();
const departments=[
{name:"Boaco",aliases:["boaco"]},{name:"Carazo",aliases:["carazo"]},{name:"Chinandega",aliases:["chinandega"]},{name:"Chontales",aliases:["chontales"]},
{name:"Estelí",aliases:["esteli"]},{name:"Granada",aliases:["granada"]},{name:"Jinotega",aliases:["jinotega"]},{name:"León",aliases:["leon"]},{name:"Madriz",aliases:["madriz"]},
{name:"Managua",aliases:["managua"]},{name:"Masaya",aliases:["masaya"]},{name:"Matagalpa",aliases:["matagalpa"]},{name:"Nueva Segovia",aliases:["nueva segovia"]},{name:"Río San Juan",aliases:["rio san juan"]},{name:"Rivas",aliases:["rivas"]},
{name:"Costa Caribe Norte",aliases:["costa caribe norte","region autonoma de la costa caribe norte","atlantico norte","racn","raccn"]},
{name:"Costa Caribe Sur",aliases:["costa caribe sur","region autonoma de la costa caribe sur","atlantico sur","racs","raccs"]}];
function mapDepartment(region,regionCode){
 const normalizedRegion=norm(region),code=norm(regionCode).replace(/ /g,"-");
 for(const d of departments)for(const alias of d.aliases)if(normalizedRegion===alias||normalizedRegion==="departamento de "+alias||normalizedRegion==="region de "+alias||normalizedRegion.startsWith(alias+" ")||normalizedRegion.endsWith(" "+alias))return d.name;
 const codes={"ni-bo":"Boaco","ni-ca":"Carazo","ni-ci":"Chinandega","ni-co":"Chontales","ni-es":"Estelí","ni-gr":"Granada","ni-ji":"Jinotega","ni-le":"León","ni-md":"Madriz","ni-mn":"Managua","ni-ms":"Masaya","ni-mt":"Matagalpa","ni-ns":"Nueva Segovia","ni-sj":"Río San Juan","ni-ri":"Rivas","ni-an":"Costa Caribe Norte","ni-as":"Costa Caribe Sur"};
 return code?codes[code]||null:null;
}
export async function onRequestGet({request}){
 const cf=request.cf||{};
 const country=clean(cf.country).toUpperCase().slice(0,2)||null;
 const department=country==="NI"?mapDepartment(cf.region,cf.regionCode):null;
 return new Response(JSON.stringify({country,department}),{status:200,headers:{"content-type":"application/json; charset=utf-8","cache-control":"no-store","x-content-type-options":"nosniff"}});
}
