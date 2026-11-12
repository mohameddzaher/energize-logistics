// Generated from backend/src/config/roles.js; do not edit by hand.
// Regenerate: node backend/src/scripts/genFrontendRoles.js
//
// Each section has a manager, a team leader with the manager's rights, staff and a trainee. Managers end in `_manager`
// and nobody else does: that suffix decides who sits in management meetings.

export interface RoleDef { key: string; ar: string; en: string; distinct?: string }
export interface SectionRoles { section: string; manager: RoleDef; staff: RoleDef[]; trainee: RoleDef; teamLeader: RoleDef }

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
    "key": "data_manager",
    "ar": "مدير إدارة البيانات ودعم القرار",
    "en": "Data & Decision Support Manager"
  },
  {
    "key": "data_analyst",
    "ar": "محلل بيانات",
    "en": "Data Analyst"
  },
  {
    "key": "data_entry",
    "ar": "مدخل بيانات",
    "en": "Data Entry Specialist"
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
  },
  {
    "key": "mediago_account",
    "ar": "مدير حساب Media Go",
    "en": "Media Go Account Manager"
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
        "key": "operations_team_leader",
        "ar": "قائد فريق العمليات",
        "en": "Operations Team Leader",
        "distinct": "له صلاحيّاتُ مدير العمليات كاملةً (التشغيل والموردون والمتابعة)، ولا يجلس في اجتماعات الإدارة."
      },
      {
        "key": "operations_staff",
        "ar": "موظف العمليات",
        "en": "Operations Team"
      }
    ],
    "teamLeader": {
      "key": "operations_team_leader",
      "ar": "قائد فريق العمليات",
      "en": "Operations Team Leader",
      "distinct": "له صلاحيّاتُ مدير العمليات كاملةً (التشغيل والموردون والمتابعة)، ولا يجلس في اجتماعات الإدارة."
    },
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
        "key": "collections_team_leader",
        "ar": "قائد فريق التحصيل",
        "en": "Collections Team Leader",
        "distinct": "له صلاحيّاتُ مدير القسم كاملةً، ولا يجلس في اجتماعات الإدارة، ويقيّمه مديرُ القسم مع فريقه."
      },
      {
        "key": "collections_staff",
        "ar": "موظف التحصيل",
        "en": "Collections Officer"
      }
    ],
    "teamLeader": {
      "key": "collections_team_leader",
      "ar": "قائد فريق التحصيل",
      "en": "Collections Team Leader",
      "distinct": "له صلاحيّاتُ مدير القسم كاملةً، ولا يجلس في اجتماعات الإدارة، ويقيّمه مديرُ القسم مع فريقه."
    },
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
        "key": "ops_platform_team_leader",
        "ar": "قائد فريق منصة الأوبريشن",
        "en": "Operations Platform Team Leader",
        "distinct": "له صلاحيّاتُ مدير القسم كاملةً، ولا يجلس في اجتماعات الإدارة، ويقيّمه مديرُ القسم مع فريقه."
      },
      {
        "key": "ops_platform_staff",
        "ar": "موظف منصة الأوبريشن",
        "en": "Operations Platform Team"
      }
    ],
    "teamLeader": {
      "key": "ops_platform_team_leader",
      "ar": "قائد فريق منصة الأوبريشن",
      "en": "Operations Platform Team Leader",
      "distinct": "له صلاحيّاتُ مدير القسم كاملةً، ولا يجلس في اجتماعات الإدارة، ويقيّمه مديرُ القسم مع فريقه."
    },
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
        "key": "shipment_orders_team_leader",
        "ar": "قائد فريق طلبات الشحنات",
        "en": "Shipment Orders Team Leader",
        "distinct": "له صلاحيّاتُ مدير القسم كاملةً، ولا يجلس في اجتماعات الإدارة، ويقيّمه مديرُ القسم مع فريقه."
      },
      {
        "key": "shipment_orders_staff",
        "ar": "موظف طلبات الشحنات",
        "en": "Shipment Orders Team"
      },
      {
        "key": "shipment_orders_followup",
        "ar": "المتابعة",
        "en": "Shipment Follow-up",
        "distinct": "يتابع الشحناتِ القائمة: يغيّر حالتَها بتفاصيلها (سببُ الإلغاء، رفعُ السند)، ويتّصل بالسائق ويكتب ملاحظةَ متابعة. وشاشتُه الشحناتُ بطاقاتٍ كبيرةً للجوّال أوّلًا."
      }
    ],
    "teamLeader": {
      "key": "shipment_orders_team_leader",
      "ar": "قائد فريق طلبات الشحنات",
      "en": "Shipment Orders Team Leader",
      "distinct": "له صلاحيّاتُ مدير القسم كاملةً، ولا يجلس في اجتماعات الإدارة، ويقيّمه مديرُ القسم مع فريقه."
    },
    "trainee": {
      "key": "shipment_orders_trainee",
      "ar": "متدرّب طلبات الشحنات",
      "en": "Shipment Orders Trainee"
    }
  },
  {
    "section": "Vendors Management",
    "manager": {
      "key": "vendors_manager",
      "ar": "مدير قسم الموردين",
      "en": "Vendors Manager"
    },
    "staff": [
      {
        "key": "vendors_team_leader",
        "ar": "قائد فريق الموردين",
        "en": "Vendors Team Leader",
        "distinct": "له صلاحيّاتُ مدير القسم كاملةً داخل القسم وفي سير عمل التشغيل، ولا يجلس في اجتماعات الإدارة."
      },
      {
        "key": "vendors_staff",
        "ar": "موظف قسم الموردين",
        "en": "Vendors Officer"
      }
    ],
    "teamLeader": {
      "key": "vendors_team_leader",
      "ar": "قائد فريق الموردين",
      "en": "Vendors Team Leader",
      "distinct": "له صلاحيّاتُ مدير القسم كاملةً داخل القسم وفي سير عمل التشغيل، ولا يجلس في اجتماعات الإدارة."
    },
    "trainee": {
      "key": "vendors_trainee",
      "ar": "متدرّب قسم الموردين",
      "en": "Vendors Trainee"
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
        "key": "fleet_team_leader",
        "ar": "قائد فريق الأسطول",
        "en": "Fleet Team Leader",
        "distinct": "له صلاحيّاتُ مدير القسم كاملةً، ولا يجلس في اجتماعات الإدارة، ويقيّمه مديرُ القسم مع فريقه."
      },
      {
        "key": "fleet_supervisor",
        "ar": "مشرف الأسطول",
        "en": "Fleet Supervisor"
      }
    ],
    "teamLeader": {
      "key": "fleet_team_leader",
      "ar": "قائد فريق الأسطول",
      "en": "Fleet Team Leader",
      "distinct": "له صلاحيّاتُ مدير القسم كاملةً، ولا يجلس في اجتماعات الإدارة، ويقيّمه مديرُ القسم مع فريقه."
    },
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
        "key": "customs_team_leader",
        "ar": "قائد فريق التخليص الجمركي",
        "en": "Customs Team Leader",
        "distinct": "له صلاحيّاتُ مدير القسم كاملةً، ولا يجلس في اجتماعات الإدارة، ويقيّمه مديرُ القسم مع فريقه."
      },
      {
        "key": "customs_officer",
        "ar": "مخلّص جمركي",
        "en": "Customs Officer"
      }
    ],
    "teamLeader": {
      "key": "customs_team_leader",
      "ar": "قائد فريق التخليص الجمركي",
      "en": "Customs Team Leader",
      "distinct": "له صلاحيّاتُ مدير القسم كاملةً، ولا يجلس في اجتماعات الإدارة، ويقيّمه مديرُ القسم مع فريقه."
    },
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
        "key": "vehicles_team_leader",
        "ar": "قائد فريق المركبات والتفاويض",
        "en": "Vehicles & Authorizations Team Leader",
        "distinct": "له صلاحيّاتُ مدير القسم كاملةً، ولا يجلس في اجتماعات الإدارة، ويقيّمه مديرُ القسم مع فريقه."
      },
      {
        "key": "vehicles_staff",
        "ar": "موظف المركبات والتفاويض",
        "en": "Vehicles & Authorizations Officer"
      }
    ],
    "teamLeader": {
      "key": "vehicles_team_leader",
      "ar": "قائد فريق المركبات والتفاويض",
      "en": "Vehicles & Authorizations Team Leader",
      "distinct": "له صلاحيّاتُ مدير القسم كاملةً، ولا يجلس في اجتماعات الإدارة، ويقيّمه مديرُ القسم مع فريقه."
    },
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
        "key": "location_team_leader",
        "ar": "قائد فريق لوكيشن سوليوشن",
        "en": "Location Solutions Team Leader",
        "distinct": "له صلاحيّاتُ مدير القسم كاملةً، ولا يجلس في اجتماعات الإدارة، ويقيّمه مديرُ القسم مع فريقه."
      },
      {
        "key": "location_staff",
        "ar": "موظف لوكيشن سوليوشن",
        "en": "Location Solutions Team"
      }
    ],
    "teamLeader": {
      "key": "location_team_leader",
      "ar": "قائد فريق لوكيشن سوليوشن",
      "en": "Location Solutions Team Leader",
      "distinct": "له صلاحيّاتُ مدير القسم كاملةً، ولا يجلس في اجتماعات الإدارة، ويقيّمه مديرُ القسم مع فريقه."
    },
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
        "key": "marketing_team_leader",
        "ar": "قائد فريق التسويق",
        "en": "Marketing Team Leader",
        "distinct": "له صلاحيّاتُ مدير القسم كاملةً، ولا يجلس في اجتماعات الإدارة، ويقيّمه مديرُ القسم مع فريقه."
      },
      {
        "key": "marketing_specialist",
        "ar": "أخصائي تسويق",
        "en": "Marketing Specialist"
      }
    ],
    "teamLeader": {
      "key": "marketing_team_leader",
      "ar": "قائد فريق التسويق",
      "en": "Marketing Team Leader",
      "distinct": "له صلاحيّاتُ مدير القسم كاملةً، ولا يجلس في اجتماعات الإدارة، ويقيّمه مديرُ القسم مع فريقه."
    },
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
        "key": "bd_team_leader",
        "ar": "قائد فريق تطوير الأعمال",
        "en": "Business Development Team Leader",
        "distinct": "له صلاحيّاتُ مدير القسم كاملةً، ولا يجلس في اجتماعات الإدارة، ويقيّمه مديرُ القسم مع فريقه."
      },
      {
        "key": "bd_specialist",
        "ar": "أخصائي تطوير الأعمال",
        "en": "Business Development Specialist"
      }
    ],
    "teamLeader": {
      "key": "bd_team_leader",
      "ar": "قائد فريق تطوير الأعمال",
      "en": "Business Development Team Leader",
      "distinct": "له صلاحيّاتُ مدير القسم كاملةً، ولا يجلس في اجتماعات الإدارة، ويقيّمه مديرُ القسم مع فريقه."
    },
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
        "key": "it_team_leader",
        "ar": "قائد فريق تقنية المعلومات",
        "en": "IT Team Leader",
        "distinct": "له صلاحيّاتُ مدير القسم كاملةً، ولا يجلس في اجتماعات الإدارة، ويقيّمه مديرُ القسم مع فريقه."
      },
      {
        "key": "it_specialist",
        "ar": "أخصائي تقنية المعلومات",
        "en": "IT Specialist"
      }
    ],
    "teamLeader": {
      "key": "it_team_leader",
      "ar": "قائد فريق تقنية المعلومات",
      "en": "IT Team Leader",
      "distinct": "له صلاحيّاتُ مدير القسم كاملةً، ولا يجلس في اجتماعات الإدارة، ويقيّمه مديرُ القسم مع فريقه."
    },
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
        "key": "administration_team_leader",
        "ar": "قائد فريق الشؤون الإدارية",
        "en": "Administration Team Leader",
        "distinct": "له صلاحيّاتُ مدير القسم كاملةً، ولا يجلس في اجتماعات الإدارة، ويقيّمه مديرُ القسم مع فريقه."
      },
      {
        "key": "administration_staff",
        "ar": "موظف الشؤون الإدارية",
        "en": "Administration Officer"
      }
    ],
    "teamLeader": {
      "key": "administration_team_leader",
      "ar": "قائد فريق الشؤون الإدارية",
      "en": "Administration Team Leader",
      "distinct": "له صلاحيّاتُ مدير القسم كاملةً، ولا يجلس في اجتماعات الإدارة، ويقيّمه مديرُ القسم مع فريقه."
    },
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
        "key": "contracts_team_leader",
        "ar": "قائد فريق العقود",
        "en": "Contracts Team Leader",
        "distinct": "له صلاحيّاتُ مدير القسم كاملةً، ولا يجلس في اجتماعات الإدارة، ويقيّمه مديرُ القسم مع فريقه."
      },
      {
        "key": "contracts_staff",
        "ar": "موظف العقود",
        "en": "Contracts Officer"
      }
    ],
    "teamLeader": {
      "key": "contracts_team_leader",
      "ar": "قائد فريق العقود",
      "en": "Contracts Team Leader",
      "distinct": "له صلاحيّاتُ مدير القسم كاملةً، ولا يجلس في اجتماعات الإدارة، ويقيّمه مديرُ القسم مع فريقه."
    },
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
        "key": "b2c_team_leader",
        "ar": "قائد فريق قطاع الأفراد",
        "en": "B2C Team Leader",
        "distinct": "له صلاحيّاتُ مدير القسم كاملةً، ولا يجلس في اجتماعات الإدارة، ويقيّمه مديرُ القسم مع فريقه."
      },
      {
        "key": "b2c_deputy",
        "ar": "نائب مدير قطاع الأفراد",
        "en": "B2C Deputy Manager",
        "distinct": "له صلاحيّاتُ مدير القطاع في القسم كلِّه، ويعلو مديري المشاريع."
      },
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
    "teamLeader": {
      "key": "b2c_team_leader",
      "ar": "قائد فريق قطاع الأفراد",
      "en": "B2C Team Leader",
      "distinct": "له صلاحيّاتُ مدير القسم كاملةً، ولا يجلس في اجتماعات الإدارة، ويقيّمه مديرُ القسم مع فريقه."
    },
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
        "key": "remote_team_leader",
        "ar": "قائد فريق العمل عن بُعد",
        "en": "Remote Work Team Leader",
        "distinct": "له صلاحيّاتُ مدير القسم كاملةً، ولا يجلس في اجتماعات الإدارة، ويقيّمه مديرُ القسم مع فريقه."
      },
      {
        "key": "remote_employee",
        "ar": "موظف عن بُعد",
        "en": "Remote Employee"
      }
    ],
    "teamLeader": {
      "key": "remote_team_leader",
      "ar": "قائد فريق العمل عن بُعد",
      "en": "Remote Work Team Leader",
      "distinct": "له صلاحيّاتُ مدير القسم كاملةً، ولا يجلس في اجتماعات الإدارة، ويقيّمه مديرُ القسم مع فريقه."
    },
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
        "key": "hr_team_leader",
        "ar": "قائد فريق الموارد البشرية",
        "en": "HR Team Leader",
        "distinct": "له صلاحيّاتُ مدير القسم كاملةً، ولا يجلس في اجتماعات الإدارة، ويقيّمه مديرُ القسم مع فريقه."
      },
      {
        "key": "hr_specialist",
        "ar": "أخصائي موارد بشرية",
        "en": "HR Specialist"
      }
    ],
    "teamLeader": {
      "key": "hr_team_leader",
      "ar": "قائد فريق الموارد البشرية",
      "en": "HR Team Leader",
      "distinct": "له صلاحيّاتُ مدير القسم كاملةً، ولا يجلس في اجتماعات الإدارة، ويقيّمه مديرُ القسم مع فريقه."
    },
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
        "key": "crm_team_leader",
        "ar": "قائد فريق إدارة العلاقات",
        "en": "CRM Team Leader",
        "distinct": "له صلاحيّاتُ مدير القسم كاملةً، ولا يجلس في اجتماعات الإدارة، ويقيّمه مديرُ القسم مع فريقه."
      },
      {
        "key": "crm_specialist",
        "ar": "أخصائي علاقات العملاء",
        "en": "CRM Specialist"
      }
    ],
    "teamLeader": {
      "key": "crm_team_leader",
      "ar": "قائد فريق إدارة العلاقات",
      "en": "CRM Team Leader",
      "distinct": "له صلاحيّاتُ مدير القسم كاملةً، ولا يجلس في اجتماعات الإدارة، ويقيّمه مديرُ القسم مع فريقه."
    },
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
        "key": "sales_team_leader",
        "ar": "قائد فريق المبيعات",
        "en": "Sales Team Leader",
        "distinct": "له صلاحيّاتُ مدير القسم كاملةً، ولا يجلس في اجتماعات الإدارة، ويقيّمه مديرُ القسم مع فريقه."
      },
      {
        "key": "sales_rep",
        "ar": "مندوب مبيعات",
        "en": "Sales Representative"
      }
    ],
    "teamLeader": {
      "key": "sales_team_leader",
      "ar": "قائد فريق المبيعات",
      "en": "Sales Team Leader",
      "distinct": "له صلاحيّاتُ مدير القسم كاملةً، ولا يجلس في اجتماعات الإدارة، ويقيّمه مديرُ القسم مع فريقه."
    },
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
        "key": "accounting_team_leader",
        "ar": "قائد فريق الحسابات",
        "en": "Accounting Team Leader",
        "distinct": "له صلاحيّاتُ مدير القسم كاملةً، ولا يجلس في اجتماعات الإدارة، ويقيّمه مديرُ القسم مع فريقه."
      },
      {
        "key": "accountant",
        "ar": "محاسب",
        "en": "Accountant"
      }
    ],
    "teamLeader": {
      "key": "accounting_team_leader",
      "ar": "قائد فريق الحسابات",
      "en": "Accounting Team Leader",
      "distinct": "له صلاحيّاتُ مدير القسم كاملةً، ولا يجلس في اجتماعات الإدارة، ويقيّمه مديرُ القسم مع فريقه."
    },
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
        "key": "procurement_team_leader",
        "ar": "قائد فريق المشتريات",
        "en": "Procurement Team Leader",
        "distinct": "له صلاحيّاتُ مدير القسم كاملةً، ولا يجلس في اجتماعات الإدارة، ويقيّمه مديرُ القسم مع فريقه."
      },
      {
        "key": "procurement_staff",
        "ar": "موظف المشتريات",
        "en": "Procurement Officer"
      }
    ],
    "teamLeader": {
      "key": "procurement_team_leader",
      "ar": "قائد فريق المشتريات",
      "en": "Procurement Team Leader",
      "distinct": "له صلاحيّاتُ مدير القسم كاملةً، ولا يجلس في اجتماعات الإدارة، ويقيّمه مديرُ القسم مع فريقه."
    },
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
// A section trainee inherits nothing: it sees only what the permissions page opens for it.
export const TRAINEE_ROLES: string[] = SECTION_ROLES.map((s) => s.trainee.key);
export const TEAM_LEADER_ROLES: string[] = SECTION_ROLES.map((s) => s.teamLeader.key);

/** Team leader to the manager whose rights it holds (backend config/roles RIGHTS_OF). */
export const RIGHTS_OF: Record<string, string> = Object.fromEntries(SECTION_ROLES.map((s) => [s.teamLeader.key, s.manager.key]));
export const rightsRoleOf = (role?: string | null): string => (role && RIGHTS_OF[role]) || role || '';
export const isTeamLeader = (role?: string | null): boolean => !!role && role in RIGHTS_OF;
/** Does this role (or a user's role) pass a role list? Also true when the list names the role whose rights it holds. */
export const roleIn = (roleOrUser: string | { role?: string | null } | null | undefined, list: readonly string[] | ReadonlySet<string>): boolean => {
  const role = typeof roleOrUser === 'string' ? roleOrUser : roleOrUser?.role;
  if (!role) return false;
  const has = (r: string) => ('has' in list ? (list as ReadonlySet<string>).has(r) : (list as readonly string[]).includes(r));
  return has(role) || has(rightsRoleOf(role));
};

const AR: Record<string, string> = Object.fromEntries(ALL_ROLE_DEFS.map((r) => [r.key, r.ar]));
const EN: Record<string, string> = Object.fromEntries(ALL_ROLE_DEFS.map((r) => [r.key, r.en]));

/** Display name of a role; an unknown key is returned readable instead of snake_case. */
export const roleLabel = (key?: string | null, lang: 'ar' | 'en' = 'ar'): string => {
  if (!key) return '';
  const m = lang === 'en' ? EN : AR;
  return m[key] || key.split('_').map((w) => w.charAt(0).toUpperCase() + w.slice(1)).join(' ');
};

/** Roles grouped by section, for dropdowns. */
export const rolesGroupedBySection = (lang: 'ar' | 'en' = 'ar') => [
  { section: lang === 'ar' ? 'أدوار عامة' : 'General', roles: GLOBAL_ROLES.filter((r) => r.key !== 'client') },
  ...SECTION_ROLES.map((s) => ({ section: s.section, roles: [s.manager, ...s.staff, s.trainee] })),
];

export const sectionOfRole = (role?: string | null): string | null => {
  const s = SECTION_ROLES.find((x) => x.manager.key === role || x.trainee.key === role || x.staff.some((y) => y.key === role));
  return s ? s.section : null;
};
export const isManagerRole = (role?: string | null): boolean => !!role && MANAGER_ROLES.includes(role);
