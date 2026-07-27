export const categories = [
  { id:'all', icon:'✦', en:'All Help', zh:'全部帮助', es:'Toda ayuda', query:'free community assistance' },
  { id:'food', icon:'🍎', en:'Food', zh:'食品', es:'Comida', query:'free food pantry soup kitchen' },
  { id:'shelter', icon:'🏠', en:'Shelter', zh:'住所', es:'Refugio', query:'homeless shelter emergency housing' },
  { id:'health', icon:'❤', en:'Healthcare', zh:'医疗', es:'Salud', query:'free clinic community health center' },
  { id:'legal', icon:'⚖', en:'Legal Aid', zh:'法律援助', es:'Ayuda legal', query:'free legal aid immigration help' },
  { id:'benefits', icon:'✓', en:'Benefits', zh:'政府福利', es:'Beneficios', query:'SNAP benefits assistance office' },
  { id:'jobs', icon:'💼', en:'Jobs', zh:'就业', es:'Empleo', query:'workforce center job help' },
  { id:'transport', icon:'🚌', en:'Transportation', zh:'交通', es:'Transporte', query:'free transportation assistance social services' }
];

export const resources = [
  {id:'211',category:'all',name:'211',short:{en:'Local referrals for food, housing, health, utilities, and more.',zh:'提供食品、住房、医疗、水电费等本地援助转介。',es:'Referencias locales para comida, vivienda, salud, servicios públicos y más.'},phone:'211',url:'https://www.211.org/',source:'211',verified:'2026-07-27',action:{en:'Open 211',zh:'打开 211',es:'Abrir 211'}},
  {id:'findhelp',category:'all',name:'Findhelp',short:{en:'Search free and reduced-cost programs by ZIP code.',zh:'按邮编搜索免费或低费用项目。',es:'Busque programas gratuitos o de bajo costo por código postal.'},url:'https://www.findhelp.org/',source:'Findhelp',verified:'2026-07-27',action:{en:'Search programs',zh:'搜索项目',es:'Buscar programas'}},
  {id:'feeding-america',category:'food',name:'Feeding America',short:{en:'Find a nearby food bank and food assistance.',zh:'查找附近的食品银行和食品援助。',es:'Encuentre un banco de alimentos y ayuda alimentaria cercana.'},url:'https://www.feedingamerica.org/find-your-local-foodbank',source:'Feeding America',verified:'2026-07-27',action:{en:'Find food',zh:'查找食品援助',es:'Buscar comida'}},
  {id:'usda-food',category:'food',name:'USDA National Hunger Hotline',short:{en:'Food assistance information and referrals.',zh:'食品援助信息和转介。',es:'Información y referencias de asistencia alimentaria.'},phone:'1-866-348-6479',url:'https://www.fns.usda.gov/national-hunger-hotline',source:'USDA',verified:'2026-07-27',action:{en:'Get food help',zh:'获取食品帮助',es:'Obtener ayuda'}},
  {id:'hud',category:'shelter',name:'HUD Housing Counseling',short:{en:'Find housing counseling and local housing help.',zh:'查找住房咨询和本地住房援助。',es:'Encuentre asesoría y ayuda local de vivienda.'},url:'https://www.hud.gov/housingcounseling',source:'HUD',verified:'2026-07-27',action:{en:'Find housing help',zh:'查找住房帮助',es:'Buscar vivienda'}},
  {id:'shelter-map',category:'shelter',name:'Emergency Shelters Nearby',short:{en:'Search maps for nearby emergency shelter options.',zh:'在地图上查找附近的紧急住所。',es:'Busque refugios de emergencia cercanos en el mapa.'},mapQuery:'emergency shelter homeless services',source:'Google Maps search',verified:'Live search',action:{en:'Search nearby',zh:'查找附近',es:'Buscar cerca'}},
  {id:'hrsa',category:'health',name:'HRSA Health Centers',short:{en:'Find low-cost community health centers.',zh:'查找低费用社区医疗中心。',es:'Encuentre centros de salud comunitarios de bajo costo.'},url:'https://findahealthcenter.hrsa.gov/',source:'HRSA',verified:'2026-07-27',action:{en:'Find a clinic',zh:'查找诊所',es:'Buscar clínica'}},
  {id:'samhsa',category:'health',name:'FindTreatment.gov',short:{en:'Mental health and substance use treatment locator.',zh:'查找心理健康和药物使用治疗服务。',es:'Buscador de tratamiento de salud mental y consumo de sustancias.'},phone:'1-800-662-4357',url:'https://findtreatment.gov/',source:'SAMHSA',verified:'2026-07-27',action:{en:'Find treatment',zh:'查找治疗',es:'Buscar tratamiento'}},
  {id:'lawhelp',category:'legal',name:'LawHelp',short:{en:'Find free civil legal help by state.',zh:'按州查找免费民事法律援助。',es:'Encuentre ayuda legal civil gratuita por estado.'},url:'https://www.lawhelp.org/',source:'LawHelp',verified:'2026-07-27',action:{en:'Find legal aid',zh:'查找法律援助',es:'Buscar ayuda legal'}},
  {id:'immigration-map',category:'legal',name:'Immigration Legal Help Nearby',short:{en:'Search for nonprofit immigration legal services.',zh:'查找非营利移民法律服务。',es:'Busque servicios legales migratorios sin fines de lucro.'},mapQuery:'nonprofit immigration legal services',source:'Google Maps search',verified:'Live search',action:{en:'Search nearby',zh:'查找附近',es:'Buscar cerca'}},
  {id:'benefits-gov',category:'benefits',name:'USA.gov Benefits',short:{en:'Official information about government benefit programs.',zh:'政府福利项目的官方信息。',es:'Información oficial sobre programas de beneficios públicos.'},url:'https://www.usa.gov/benefits',source:'USA.gov',verified:'2026-07-27',action:{en:'See benefits',zh:'查看福利',es:'Ver beneficios'}},
  {id:'snap',category:'benefits',name:'SNAP State Directory',short:{en:'Find your state SNAP office and application information.',zh:'查找所在州的 SNAP 办公室和申请信息。',es:'Encuentre la oficina SNAP de su estado e información de solicitud.'},url:'https://www.fns.usda.gov/snap/state-directory',source:'USDA',verified:'2026-07-27',action:{en:'Find SNAP office',zh:'查找 SNAP 办公室',es:'Buscar oficina SNAP'}},
  {id:'career-one-stop',category:'jobs',name:'American Job Centers',short:{en:'Free job search, training, résumé, and career support.',zh:'免费求职、培训、简历和职业支持。',es:'Búsqueda de empleo, capacitación, currículum y apoyo profesional gratis.'},url:'https://www.careeronestop.org/LocalHelp/AmericanJobCenters/american-job-centers.aspx',source:'CareerOneStop',verified:'2026-07-27',action:{en:'Find job help',zh:'查找就业帮助',es:'Buscar empleo'}},
  {id:'transport-map',category:'transport',name:'Transportation Assistance Nearby',short:{en:'Search for nonprofit and social-service transportation help.',zh:'查找非营利机构和社会服务交通援助。',es:'Busque ayuda de transporte de organizaciones sociales.'},mapQuery:'free transportation assistance social services',source:'Google Maps search',verified:'Live search',action:{en:'Search nearby',zh:'查找附近',es:'Buscar cerca'}},
  {id:'libraries',category:'all',name:'Public Libraries',short:{en:'Internet access, charging, restrooms, and local information.',zh:'提供网络、充电、洗手间和本地信息。',es:'Internet, carga, baños e información local.'},mapQuery:'public library',source:'Google Maps search',verified:'Live search',action:{en:'Find a library',zh:'查找图书馆',es:'Buscar biblioteca'}}
];

export const quickQuestions = {
  en:['I need food today','I need shelter tonight','Find a free clinic','Help with SNAP'],
  zh:['我今天需要食品','我今晚需要住所','查找免费诊所','帮助申请 SNAP'],
  es:['Necesito comida hoy','Necesito refugio esta noche','Buscar clínica gratis','Ayuda con SNAP']
};
