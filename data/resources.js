export const categories = [
  { id: 'food', label: 'Food', icon: '🍽️', query: 'free food pantry soup kitchen' },
  { id: 'shelter', label: 'Shelter', icon: '🛏️', query: 'homeless shelter emergency housing' },
  { id: 'health', label: 'Health', icon: '🏥', query: 'free clinic community health center' },
  { id: 'showers', label: 'Showers', icon: '🚿', query: 'free public shower homeless services' },
  { id: 'jobs', label: 'Jobs', icon: '💼', query: 'workforce center job help' },
  { id: 'transport', label: 'Rides', icon: '🚌', query: 'free transportation assistance social services' },
  { id: 'benefits', label: 'Benefits', icon: '📄', query: 'SNAP benefits assistance office' },
  { id: 'legal', label: 'Legal', icon: '⚖️', query: 'free legal aid' }
];

export const nationalResources = [
  {
    id: '211', category: 'all', name: '211', short: 'Local help by phone or web',
    phone: '211', url: 'https://www.211.org/', action: 'Open 211'
  },
  {
    id: 'findhelp', category: 'all', name: 'Findhelp', short: 'Search free and reduced-cost programs',
    url: 'https://www.findhelp.org/', action: 'Search programs'
  },
  {
    id: 'hud', category: 'shelter', name: 'HUD Help', short: 'Housing and shelter resources',
    url: 'https://www.hud.gov/housingcounseling', action: 'Find housing help'
  },
  {
    id: 'feeding-america', category: 'food', name: 'Feeding America', short: 'Find a nearby food bank',
    url: 'https://www.feedingamerica.org/find-your-local-foodbank', action: 'Find food'
  },
  {
    id: 'usda-food', category: 'food', name: 'USDA Food Help', short: 'Food programs and benefit information',
    url: 'https://www.fns.usda.gov/national-hunger-hotline', action: 'Get food help'
  },
  {
    id: 'hrsa', category: 'health', name: 'Health Centers', short: 'Low-cost community health care',
    url: 'https://findahealthcenter.hrsa.gov/', action: 'Find a clinic'
  },
  {
    id: 'samhsa', category: 'health', name: 'Mental Health Help', short: 'Treatment and support locator',
    phone: '1-800-662-4357', url: 'https://findtreatment.gov/', action: 'Find treatment'
  },
  {
    id: 'benefits-gov', category: 'benefits', name: 'USA.gov Benefits', short: 'Government benefit programs',
    url: 'https://www.usa.gov/benefits', action: 'See benefits'
  },
  {
    id: 'snap', category: 'benefits', name: 'SNAP', short: 'Food benefit information by state',
    url: 'https://www.fns.usda.gov/snap/state-directory', action: 'Find SNAP office'
  },
  {
    id: 'career-one-stop', category: 'jobs', name: 'American Job Centers', short: 'Free job and training help',
    url: 'https://www.careeronestop.org/LocalHelp/AmericanJobCenters/american-job-centers.aspx', action: 'Find job help'
  },
  {
    id: 'lawhelp', category: 'legal', name: 'LawHelp', short: 'Free legal help by state',
    url: 'https://www.lawhelp.org/', action: 'Find legal aid'
  },
  {
    id: 'va', category: 'all', name: 'Veterans Help', short: 'Housing, health, and crisis support',
    phone: '1-877-424-3838', url: 'https://www.va.gov/homeless/', action: 'Get veteran help'
  },
  {
    id: 'libraries', category: 'all', name: 'Public Libraries', short: 'Internet, charging, restrooms, and local help',
    mapQuery: 'public library', action: 'Find a library'
  },
  {
    id: 'community-fridge', category: 'food', name: 'Community Fridges', short: 'Search nearby free community food',
    mapQuery: 'community fridge free food', action: 'Search nearby'
  },
  {
    id: 'showers-map', category: 'showers', name: 'Showers Nearby', short: 'Search local day centers and shower programs',
    mapQuery: 'homeless day center showers', action: 'Search nearby'
  },
  {
    id: 'transit-map', category: 'transport', name: 'Ride Help Nearby', short: 'Search local transportation programs',
    mapQuery: 'free transportation assistance social services', action: 'Search nearby'
  }
];

export const quickQuestions = [
  'Food near me',
  'Shelter tonight',
  'Free clinic',
  'Showers near me',
  'Help with SNAP',
  'Call 211'
];
