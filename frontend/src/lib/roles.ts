// ⚠️ مولَّد من backend/src/config/roles.js — متعدّلش الملف ده بالإيد.
// عشان تحدّثه:  node backend/src/scripts/genFrontendRoles.js
//
// الهيكل الوظيفي: كل قسم له مدير وموظف. المديرين بينتهوا بـ `_manager`
// والموظفين لأ — القاعدة دي هي اللي بيتحدد بيها مين يقعد في اجتماعات الإدارة.

export interface RoleDef { key: string; ar: string; en: string }
export interface SectionRoles { section: string; manager: RoleDef; staff: RoleDef[]; trainee: RoleDef }

export const GLOBAL_ROLES: RoleDef[] = [
  {
    "key": "super_admin",
    "ar": "مدير النظام",
    "en": "System Administrator"
  },
  {
    "key": "admin",
    "ar": "الإدارة العليا",
    "en": "Executive Management"
  },
  {
    "key": "moderator",
    "ar": "مشرف عام",
    "en": "General Supervisor"
  },
  {
    "key": "cfo",
    "ar": "المدير المالي",
    "en": "Chief Financial Officer"
  },
  {
    "key": "employee",
    "ar": "موظف",
    "en": "Employee"
  },
  {
    "key": "client",
    "ar": "شريك خارجي",
    "en": "External Partner"
  }
];

export const SECTION_ROLES: SectionRoles[] = [
  {
    "section": "Operations",
    "manager": {
      "key": "operations_manager",
      "ar": "مدير العمليات",
      "en": "Operations Manager"
    },
    "staff": [
      {
        "key": "operations_staff",
        "ar": "موظف العمليات",
        "en": "Operations Team"
      }
    ],
    "trainee": {
      "key": "operations_trainee",
      "ar": "متدرّب العمليات",
      "en": "Operations Trainee"
    }
  },
  {
    "section": "Collections",
    "manager": {
      "key": "collections_manager",
      "ar": "مدير التحصيل",
      "en": "Collections Manager"
    },
    "staff": [
      {
        "key": "collections_staff",
        "ar": "موظف التحصيل",
        "en": "Collections Officer"
      }
    ],
    "trainee": {
      "key": "collections_trainee",
      "ar": "متدرّب التحصيل",
      "en": "Collections Trainee"
    }
  },
  {
    "section": "Operations Platform",
    "manager": {
      "key": "ops_platform_manager",
      "ar": "مدير منصة الأوبريشن",
      "en": "Operations Platform Manager"
    },
    "staff": [
      {
        "key": "ops_platform_staff",
        "ar": "موظف منصة الأوبريشن",
        "en": "Operations Platform Team"
      }
    ],
    "trainee": {
      "key": "ops_platform_trainee",
      "ar": "متدرّب منصة الأوبريشن",
      "en": "Operations Platform Trainee"
    }
  },
  {
    "section": "Shipment Orders",
    "manager": {
      "key": "shipment_orders_manager",
      "ar": "مدير طلبات الشحنات",
      "en": "Shipment Orders Manager"
    },
    "staff": [
      {
        "key": "shipment_orders_staff",
        "ar": "موظف طلبات الشحنات",
        "en": "Shipment Orders Team"
      }
    ],
    "trainee": {
      "key": "shipment_orders_trainee",
      "ar": "متدرّب طلبات الشحنات",
      "en": "Shipment Orders Trainee"
    }
  },
  {
    "section": "Fleet Management",
    "manager": {
      "key": "fleet_manager",
      "ar": "مدير الأسطول",
      "en": "Fleet Manager"
    },
    "staff": [
      {
        "key": "fleet_supervisor",
        "ar": "مشرف الأسطول",
        "en": "Fleet Supervisor"
      }
    ],
    "trainee": {
      "key": "fleet_trainee",
      "ar": "متدرّب الأسطول",
      "en": "Fleet Trainee"
    }
  },
  {
    "section": "Customs",
    "manager": {
      "key": "customs_manager",
      "ar": "مدير التخليص الجمركي",
      "en": "Customs Manager"
    },
    "staff": [
      {
        "key": "customs_officer",
        "ar": "مخلّص جمركي",
        "en": "Customs Officer"
      }
    ],
    "trainee": {
      "key": "customs_trainee",
      "ar": "متدرّب التخليص الجمركي",
      "en": "Customs Trainee"
    }
  },
  {
    "section": "Vehicles",
    "manager": {
      "key": "vehicles_manager",
      "ar": "مدير المركبات والتفاويض",
      "en": "Vehicles & Authorizations Manager"
    },
    "staff": [
      {
        "key": "vehicles_staff",
        "ar": "موظف المركبات والتفاويض",
        "en": "Vehicles & Authorizations Officer"
      }
    ],
    "trainee": {
      "key": "vehicles_trainee",
      "ar": "متدرّب المركبات والتفاويض",
      "en": "Vehicles & Authorizations Trainee"
    }
  },
  {
    "section": "Location Solutions",
    "manager": {
      "key": "location_manager",
      "ar": "مدير لوكيشن سوليوشن",
      "en": "Location Solutions Manager"
    },
    "staff": [
      {
        "key": "location_staff",
        "ar": "موظف لوكيشن سوليوشن",
        "en": "Location Solutions Team"
      }
    ],
    "trainee": {
      "key": "location_trainee",
      "ar": "متدرّب لوكيشن سوليوشن",
      "en": "Location Solutions Trainee"
    }
  },
  {
    "section": "Marketing",
    "manager": {
      "key": "marketing_manager",
      "ar": "مدير التسويق",
      "en": "Marketing Manager"
    },
    "staff": [
      {
        "key": "marketing_specialist",
        "ar": "أخصائي تسويق",
        "en": "Marketing Specialist"
      }
    ],
    "trainee": {
      "key": "marketing_trainee",
      "ar": "متدرّب التسويق",
      "en": "Marketing Trainee"
    }
  },
  {
    "section": "Business Development",
    "manager": {
      "key": "bd_manager",
      "ar": "مدير تطوير الأعمال",
      "en": "Business Development Manager"
    },
    "staff": [
      {
        "key": "bd_specialist",
        "ar": "أخصائي تطوير الأعمال",
        "en": "Business Development Specialist"
      }
    ],
    "trainee": {
      "key": "bd_trainee",
      "ar": "متدرّب تطوير الأعمال",
      "en": "Business Development Trainee"
    }
  },
  {
    "section": "Software & IT",
    "manager": {
      "key": "it_manager",
      "ar": "مدير تقنية المعلومات",
      "en": "IT Manager"
    },
    "staff": [
      {
        "key": "it_specialist",
        "ar": "أخصائي تقنية المعلومات",
        "en": "IT Specialist"
      }
    ],
    "trainee": {
      "key": "it_trainee",
      "ar": "متدرّب تقنية المعلومات",
      "en": "IT Trainee"
    }
  },
  {
    "section": "Administration",
    "manager": {
      "key": "administration_manager",
      "ar": "مدير الشؤون الإدارية",
      "en": "Administration Manager"
    },
    "staff": [
      {
        "key": "administration_staff",
        "ar": "موظف الشؤون الإدارية",
        "en": "Administration Officer"
      }
    ],
    "trainee": {
      "key": "administration_trainee",
      "ar": "متدرّب الشؤون الإدارية",
      "en": "Administration Trainee"
    }
  },
  {
    "section": "Contracts",
    "manager": {
      "key": "contracts_manager",
      "ar": "مدير العقود",
      "en": "Contracts Manager"
    },
    "staff": [
      {
        "key": "contracts_staff",
        "ar": "موظف العقود",
        "en": "Contracts Officer"
      }
    ],
    "trainee": {
      "key": "contracts_trainee",
      "ar": "متدرّب العقود",
      "en": "Contracts Trainee"
    }
  },
  {
    "section": "B2C",
    "manager": {
      "key": "b2c_manager",
      "ar": "مدير قطاع الأفراد",
      "en": "B2C Manager"
    },
    "staff": [
      {
        "key": "b2c_project_lead",
        "ar": "مدير مشروع - أفراد",
        "en": "B2C Project Lead"
      },
      {
        "key": "b2c_rep_supervisor",
        "ar": "مشرف المناديب التشغيلي",
        "en": "B2C Ops Rep Supervisor",
        "distinct": "يقف على يوم المندوب: الإدخالُ اليوميّ وأوامرُ التشغيل والأداءُ والعهدة. ولا يوزّع المناديب ولا يعدّلهم — ذاك لمدير المشروع ومدير القطاع."
      },
      {
        "key": "b2c_inspection_supervisor",
        "ar": "مشرف المناديب التفقدي",
        "en": "B2C Inspection Supervisor",
        "distinct": "للتفقّد وحدَه: «تفقّد بداية الدوام» بالكاميرا الحيّة وسجلُّه وتحليلُه. لا يُدخِل يومًا ولا يصدر أمرَ تشغيلٍ ولا يوزّع المناديب. والتفقّدُ يبقى إسنادًا يُكتب على كلّ مندوبٍ من سجلّ النقل الخفيف، ويصحّ لمدير المشروع ومدير القطاع أيضًا."
      }
    ],
    "trainee": {
      "key": "b2c_trainee",
      "ar": "متدرّب قطاع الأفراد",
      "en": "B2C Trainee"
    }
  },
  {
    "section": "Remote",
    "manager": {
      "key": "remote_manager",
      "ar": "مدير العمل عن بُعد",
      "en": "Remote Work Manager"
    },
    "staff": [
      {
        "key": "remote_employee",
        "ar": "موظف عن بُعد",
        "en": "Remote Employee"
      }
    ],
    "trainee": {
      "key": "remote_trainee",
      "ar": "متدرّب العمل عن بُعد",
      "en": "Remote Work Trainee"
    }
  },
  {
    "section": "HR",
    "manager": {
      "key": "hr_manager",
      "ar": "مدير الموارد البشرية",
      "en": "HR Manager"
    },
    "staff": [
      {
        "key": "hr_specialist",
        "ar": "أخصائي موارد بشرية",
        "en": "HR Specialist"
      }
    ],
    "trainee": {
      "key": "hr_trainee",
      "ar": "متدرّب الموارد البشرية",
      "en": "HR Trainee"
    }
  },
  {
    "section": "CRM",
    "manager": {
      "key": "crm_manager",
      "ar": "مدير إدارة العلاقات",
      "en": "CRM Manager"
    },
    "staff": [
      {
        "key": "crm_specialist",
        "ar": "أخصائي علاقات العملاء",
        "en": "CRM Specialist"
      }
    ],
    "trainee": {
      "key": "crm_trainee",
      "ar": "متدرّب إدارة العلاقات",
      "en": "CRM Trainee"
    }
  },
  {
    "section": "Sales",
    "manager": {
      "key": "sales_manager",
      "ar": "مدير المبيعات",
      "en": "Sales Manager"
    },
    "staff": [
      {
        "key": "sales_rep",
        "ar": "مندوب مبيعات",
        "en": "Sales Representative"
      }
    ],
    "trainee": {
      "key": "sales_trainee",
      "ar": "متدرّب المبيعات",
      "en": "Sales Trainee"
    }
  },
  {
    "section": "Accounting",
    "manager": {
      "key": "accounting_manager",
      "ar": "مدير الحسابات",
      "en": "Accounting Manager"
    },
    "staff": [
      {
        "key": "accountant",
        "ar": "محاسب",
        "en": "Accountant"
      }
    ],
    "trainee": {
      "key": "accounting_trainee",
      "ar": "متدرّب الحسابات",
      "en": "Accounting Trainee"
    }
  },
  {
    "section": "Procurement",
    "manager": {
      "key": "procurement_manager",
      "ar": "مدير المشتريات",
      "en": "Procurement Manager"
    },
    "staff": [
      {
        "key": "procurement_staff",
        "ar": "موظف المشتريات",
        "en": "Procurement Officer"
      }
    ],
    "trainee": {
      "key": "procurement_trainee",
      "ar": "متدرّب المشتريات",
      "en": "Procurement Trainee"
    }
  }
];

export const ALL_ROLE_DEFS: RoleDef[] = [
  ...GLOBAL_ROLES,
  ...SECTION_ROLES.flatMap((s) => [s.manager, ...s.staff, s.trainee]),
];
export const ALL_ROLES: string[] = ALL_ROLE_DEFS.map((r) => r.key);
export const MANAGER_ROLES: string[] = SECTION_ROLES.map((s) => s.manager.key);
export const STAFF_ROLES: string[] = SECTION_ROLES.flatMap((s) => s.staff.map((x) => x.key));
// متدرّبُ القسم: لا يرث شيئًا — يُفتَح له ما يُفتَح من صفحة الصلاحيّات.
export const TRAINEE_ROLES: string[] = SECTION_ROLES.map((s) => s.trainee.key);

const AR: Record<string, string> = Object.fromEntries(ALL_ROLE_DEFS.map((r) => [r.key, r.ar]));
const EN: Record<string, string> = Object.fromEntries(ALL_ROLE_DEFS.map((r) => [r.key, r.en]));

/** اسم الدور للعرض. مفتاح مش معروف بيترجع مقروء بدل ما يظهر snake_case. */
export const roleLabel = (key?: string | null, lang: 'ar' | 'en' = 'ar'): string => {
  if (!key) return '';
  const m = lang === 'en' ? EN : AR;
  return m[key] || key.split('_').map((w) => w.charAt(0).toUpperCase() + w.slice(1)).join(' ');
};

/** الأدوار مرتّبة حسب القسم — للقوائم المنسدلة، عشان المستخدم يلاقي دوره جنب قسمه. */
export const rolesGroupedBySection = (lang: 'ar' | 'en' = 'ar') => [
  { section: lang === 'ar' ? 'أدوار عامة' : 'General', roles: GLOBAL_ROLES.filter((r) => r.key !== 'client') },
  ...SECTION_ROLES.map((s) => ({ section: s.section, roles: [s.manager, ...s.staff, s.trainee] })),
];

export const sectionOfRole = (role?: string | null): string | null => {
  const s = SECTION_ROLES.find((x) => x.manager.key === role || x.trainee.key === role || x.staff.some((y) => y.key === role));
  return s ? s.section : null;
};
export const isManagerRole = (role?: string | null): boolean => !!role && MANAGER_ROLES.includes(role);
