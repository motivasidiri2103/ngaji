const AKSI_DIIJINKAN = new Set([
  "ambilDashboard",
  "ambilDashboardWali",
  "ambilFormKehadiran",
  "ambilFormSetoran",
  "ambilKonfigurasiPublik",
  "ambilPengaturan",
  "ambilReferensi",
  "autentikasiKeluar",
  "autentikasiMasuk",
  "buatBackupManual",
  "buatPdfLaporanKelas",
  "buatPdfLaporanSantri",
  "buatTarget",
  "buatTokenPortalWali",
  "daftarAnggotaKelas",
  "daftarAudit",
  "daftarBackup",
  "daftarCatatan",
  "daftarJadwal",
  "daftarKelas",
  "daftarMateri",
  "daftarPengajar",
  "daftarPengguna",
  "daftarPengumuman",
  "daftarSantri",
  "daftarTarget",
  "daftarWali",
  "detailKelas",
  "detailSantri",
  "eksporCsv",
  "gantiPassword",
  "laporanKehadiran",
  "laporanKelas",
  "laporanSantri",
  "laporanSetoran",
  "pasangTriggerBackup",
  "resetPasswordPengguna",
  "riwayatSetoranSantri",
  "simpanCatatan",
  "simpanJadwal",
  "simpanKehadiranBatch",
  "simpanKelas",
  "simpanMateri",
  "simpanPengajar",
  "simpanPengaturan",
  "simpanPengguna",
  "simpanPengumuman",
  "simpanSantri",
  "simpanSetoran",
  "simpanWali",
  "tambahAnggotaKelas",
  "validasiToken"
]);

function responsJson(data,status=200,headers={}){
  return new Response(JSON.stringify(data),{status,headers:{'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store','X-Content-Type-Options':'nosniff',...headers}});
}

function normalisasiAsal(nilai){
  return String(nilai||'').trim().replace(/\/$/,'').toLowerCase();
}

function asalDiizinkan(request){
  const origin=normalisasiAsal(request.headers.get('origin'));
  if(!origin)return true;

  let asalPermintaan='';
  try{
    asalPermintaan=normalisasiAsal(new URL(request.url).origin);
  }catch(error){}

  const kandidat=[
    asalPermintaan,
    process.env.URL,
    ...String(process.env.ALLOWED_ORIGINS||'').split(',')
  ].map(normalisasiAsal).filter(Boolean);

  if(process.env.CONTEXT==='dev'){
    kandidat.push('http://localhost:8888','http://127.0.0.1:8888');
  }

  return kandidat.includes(origin);
}

export default async function handler(request,context){
  if(request.method==='OPTIONS')return new Response(null,{status:204,headers:{'Allow':'POST, OPTIONS','Cache-Control':'no-store'}});
  if(request.method!=='POST')return responsJson({sukses:false,kode:'METODE_TIDAK_DIIJINKAN',pesan:'Gunakan metode POST.'},405,{'Allow':'POST'});
  if(!asalDiizinkan(request))return responsJson({sukses:false,kode:'ASAL_DITOLAK',pesan:'Asal permintaan tidak diizinkan.'},403);

  const gasUrl=String(process.env.GAS_WEB_APP_URL||'').trim();
  const apiSecret=String(process.env.GAS_API_SECRET||'').trim();
  if(!gasUrl||!apiSecret)return responsJson({sukses:false,kode:'KONFIGURASI_PROXY_TIDAK_LENGKAP',pesan:'Environment variable GAS_WEB_APP_URL atau GAS_API_SECRET belum dikonfigurasi.'},500);
  if(!/^https:\/\/script\.google\.com\/macros\/s\/.+\/exec$/.test(gasUrl))return responsJson({sukses:false,kode:'URL_GAS_TIDAK_VALID',pesan:'GAS_WEB_APP_URL harus menggunakan URL deployment /exec.'},500);

  const panjang=Number(request.headers.get('content-length')||0);
  if(panjang>1_000_000)return responsJson({sukses:false,kode:'PAYLOAD_TERLALU_BESAR',pesan:'Ukuran permintaan melebihi batas.'},413);

  let payload;
  try{payload=await request.json();}catch(error){return responsJson({sukses:false,kode:'JSON_TIDAK_VALID',pesan:'Format JSON permintaan tidak valid.'},400);}
  const aksi=String(payload?.aksi||'').trim();
  const argumen=Array.isArray(payload?.argumen)?payload.argumen:[];
  if(!AKSI_DIIJINKAN.has(aksi))return responsJson({sukses:false,kode:'AKSI_DITOLAK',pesan:'Aksi API tidak diizinkan.'},403);
  if(argumen.length>12)return responsJson({sukses:false,kode:'ARGUMEN_BERLEBIHAN',pesan:'Jumlah argumen melebihi batas.'},400);

  const forwardedFor=request.headers.get('x-forwarded-for')||'';
  const controller=new AbortController();
  const timer=setTimeout(()=>controller.abort(),26000);
  try{
    const upstream=await fetch(gasUrl,{
      method:'POST',
      headers:{'Content-Type':'application/json; charset=utf-8','Accept':'application/json','User-Agent':'Monitoring-Mengaji-Netlify-Proxy/2.0'},
      body:JSON.stringify({
        api_secret:apiSecret,
        aksi,
        argumen,
        metadata:{
          request_id:context?.requestId||crypto.randomUUID(),
          alamat_ip:String(forwardedFor).split(',')[0].trim(),
          user_agent:request.headers.get('user-agent')||'',
          asal:request.headers.get('origin')||''
        }
      }),
      redirect:'follow',
      signal:controller.signal
    });
    const teks=await upstream.text();
    let data;
    try{data=JSON.parse(teks);}catch(error){return responsJson({sukses:false,kode:'RESPONS_GAS_TIDAK_VALID',pesan:'Google Apps Script mengembalikan respons yang tidak valid.'},502);}
    if(!upstream.ok)return responsJson({sukses:false,kode:'GAS_HTTP_ERROR',pesan:data?.pesan||`Google Apps Script gagal (${upstream.status}).`},502);
    return responsJson(data,200);
  }catch(error){
    if(error?.name==='AbortError')return responsJson({sukses:false,kode:'GAS_TIMEOUT',pesan:'Google Apps Script membutuhkan waktu terlalu lama.'},504);
    return responsJson({sukses:false,kode:'PROXY_GAGAL',pesan:'Proxy tidak dapat menghubungi Google Apps Script.'},502);
  }finally{clearTimeout(timer);}
}

export const config={path:'/api'};
