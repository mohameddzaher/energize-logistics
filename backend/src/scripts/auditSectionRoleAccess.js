/**
 * auditSectionRoleAccess — مدير كل قسم وموظفه بيوصلوا لـ API قسمهم فعلاً؟
 *
 *   node src/scripts/auditSectionRoleAccess.js                      النص الأول
 *   node src/scripts/auditSectionRoleAccess.js --b                  النص التاني
 *   node src/scripts/auditSectionRoleAccess.js --base http://…      بيئة تانية
 *
 * بيعمل مستخدم مؤقت لكل دور وبيجرّب endpoint حقيقي من قسمه. المهم إن الرد
 * **مش 401/403** — الحالة الفعلية (200 أو حتى 404 لو الداتا فاضية) مش مهمة.
 *
 * ليه نصّين؟ حدّ تسجيل الدخول ٣٠ محاولة/١٥ دقيقة والفحص محتاج ٤٢. شغّل النص
 * الأول، أعد تشغيل الـ API (العدّاد في الذاكرة)، وبعدين النص التاني.
 *
 * بيمسح مستخدميه (zz-nr-*) في الآخر ولا بيلمس حساب حقيقي.
 */
require('dotenv').config();
const mongoose = require('mongoose');
const argv = process.argv.slice(2);
const iB = argv.indexOf('--base');
const BASE = (iB >= 0 && argv[iB + 1] ? argv[iB + 1] : process.env.BASE || 'http://localhost:5599').replace(/\/$/, '');
let pass=0, fail=0;
const ok=(l,c,x='')=>{console.log(`  ${c?'✓':'✗ FAIL'}  ${l}${x?'  — '+x:''}`);c?pass++:fail++;};
async function login(e){const r=await fetch(`${BASE}/api/auth/login`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({email:e,password:'Test@12345'})});
 if(r.status===429){console.error('RATE LIMITED');process.exit(2);} return {status:r.status, ck:(r.headers.getSetCookie?.()||[]).map(c=>c.split(';')[0]).join('; ')};}
async function get(p,ck){const r=await fetch(`${BASE}${p}`,{headers:{Cookie:ck}});return r.status;}
(async()=>{
  await mongoose.connect(process.env.MONGODB_URI,{serverSelectionTimeoutMS:20000});
  const User=require('../models/User');
  const R=require('../config/roles');
  await User.deleteMany({email:{$regex:'^zz-nr'}});

  // كل قسم: بنعمل مدير وموظف وبنشوف الاتنين بيوصلوا لـ API قسمهم فعلاً.
  const API_OF = {
    'Operations':'/api/wallet/daily','Customs':'/api/customs-clearance','Vehicles':'/api/vehicle-registry',
    'Location Solutions':'/api/ls2/store','Marketing':'/api/marketing/dashboard','Business Development':'/api/business-development/dashboard',
    'Software & IT':'/api/it/emails','Administration':'/api/admin-tasks','Contracts':'/api/contracts/dashboard',
    'B2C':'/api/b2c/dashboard','Workshop':'/api/workshop/inventory','Remote':'/api/remote/dashboard',
    'HR':'/api/hr/employees','CRM':'/api/crm/companies','Sales':'/api/sales/targets','Accounting':'/api/accounting/accounts',
    'Procurement':'/api/procurement/dashboard','Shipment Orders':'/api/shipment-orders/orders','Fleet Management':'/api/fleet/shipments',
  };
  console.log('كل قسم: المدير والموظف بيوصلوا لـ API القسم؟\n');
  const HALF = process.argv.includes('--b') ? R.SECTION_ROLES.slice(11) : R.SECTION_ROLES.slice(0, 11);
  for (const sec of HALF) {
    const api = API_OF[sec.section];
    if (!api) { console.log(`  ~  ${sec.section} — مفيش endpoint متحدد للفحص`); continue; }
    const roles = [sec.manager.key, sec.staff[0].key];
    const codes = [];
    for (const role of roles) {
      const u = await User.create({email:`zz-nr-${role}@example.invalid`,password:'Test@12345',firstName:'ت',lastName:'ت',role});
      const {status,ck} = await login(u.email);
      codes.push(status===200 ? await get(api, ck) : 'login '+status);
    }
    const good = codes.every(c => c!==403 && c!==401);
    ok(`${sec.section}`, good, `${roles[0]}=${codes[0]} · ${roles[1]}=${codes[1]}`);
  }
  await User.deleteMany({email:{$regex:'^zz-nr'}});
  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail?1:0);
})().catch(e=>{console.error('FATAL',e);process.exit(1);});
