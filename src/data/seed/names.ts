export const FIRST_NAMES_M = [
  'Tendai', 'Farai', 'Tafadzwa', 'Kudzai', 'Nyasha', 'Blessing', 'Takudzwa', 'Tinashe', 'Simbarashe', 'Lovemore',
  'Munyaradzi', 'Tatenda', 'Panashe', 'Brighton', 'Gift', 'Prince', 'Thabani', 'Ronald', 'Wellington', 'Cleopas',
  'Innocent', 'Learnmore', 'Misheck', 'Admire', 'Knowledge', 'Dennis', 'Garikai', 'Edmore', 'Shingirai', 'Bhekani',
  'Sibusiso', 'Mthulisi', 'Nkosana', 'Themba', 'Vusumuzi', 'Obert', 'Freddy', 'Elton', 'Cosmas', 'Tonderai',
]
export const FIRST_NAMES_F = ['Rutendo', 'Chipo', 'Nomsa', 'Precious', 'Tariro', 'Memory', 'Sithembile', 'Ruvimbo']

export const SURNAMES = [
  'Moyo', 'Ncube', 'Chikwanha', 'Mutasa', 'Dube', 'Sibanda', 'Mpofu', 'Chirwa', 'Gumbo', 'Ndlovu', 'Banda', 'Zhou',
  'Mhlanga', 'Chigumba', 'Marufu', 'Mudzingwa', 'Nyathi', 'Khumalo', 'Mavhunga', 'Chuma', 'Chiweshe', 'Mapfumo',
  'Makoni', 'Tshuma', 'Mugabe', 'Shumba', 'Mlambo', 'Hove', 'Nhamo', 'Muzenda', 'Chinembiri', 'Masvingo', 'Chitiyo',
  'Gwatidzo', 'Mawere', 'Matsika', 'Kanyemba', 'Sithole', 'Maphosa', 'Ncube', 'Bvuma', 'Jongwe',
]

export const COLOURS = ['White', 'White', 'White', 'Silver', 'Blue', 'Red', 'Grey', 'Green']

export const COMPANY_NAME = 'Zambezi Freight & Logistics'

export const CUSTOMER_SEEDS: { name: string; industry: string; city: string }[] = [
  { name: 'Zambezi Foods (Pvt) Ltd', industry: 'Food & Beverage', city: 'Harare' },
  { name: 'Msasa Beverages', industry: 'Food & Beverage', city: 'Harare' },
  { name: 'Great Dyke Mining Supplies', industry: 'Mining', city: 'Kwekwe' },
  { name: 'Limpopo Fresh Produce', industry: 'Agriculture', city: 'Beitbridge' },
  { name: 'Kopje Retail Group', industry: 'Retail', city: 'Harare' },
  { name: 'Matabele Cement Co.', industry: 'Construction', city: 'Bulawayo' },
  { name: 'Tendai Hardware & Building', industry: 'Construction', city: 'Gweru' },
  { name: 'Victoria Agro-Dealers', industry: 'Agriculture', city: 'Masvingo' },
  { name: 'Highveld Pharma Distributors', industry: 'Healthcare', city: 'Harare' },
  { name: 'Savanna Dairy Co-operative', industry: 'Food & Beverage', city: 'Chinhoyi' },
  { name: 'Chimanimani Timber Products', industry: 'Forestry', city: 'Mutare' },
  { name: 'Eastern Highlands Tea Estates', industry: 'Agriculture', city: 'Mutare' },
  { name: 'Sable Fuels Distribution', industry: 'Energy', city: 'Harare' },
  { name: 'Kariba Fisheries Ltd', industry: 'Food & Beverage', city: 'Harare' },
  { name: 'Manyame Poultry Producers', industry: 'Agriculture', city: 'Chinhoyi' },
  { name: 'Rusape Grain Millers', industry: 'Agriculture', city: 'Mutare' },
  { name: 'Bulawayo Steel Works', industry: 'Manufacturing', city: 'Bulawayo' },
  { name: 'Kalahari Furniture Mart', industry: 'Retail', city: 'Bulawayo' },
  { name: 'Mukuvisi Packaging', industry: 'Manufacturing', city: 'Harare' },
  { name: 'Hwange Coal Logistics', industry: 'Mining', city: 'Bulawayo' },
]

export const CARGO: Record<string, string[]> = {
  general: [
    'Assorted FMCG pallets', 'Cement – 50kg bags', 'Roofing sheets & timber', 'Household appliances', 'Packaging materials',
    'Retail stock replenishment', 'Building materials', 'Beverage crates & kegs', 'Steel rebar bundles', 'Furniture – flat packs',
  ],
  fuel: ['Diesel 50ppm – bulk', 'Unleaded petrol 95 – bulk', 'Diesel 500ppm – bulk', 'Jet A1 – bulk'],
  perishable: ['Frozen poultry', 'Fresh vegetables – cold chain', 'Dairy products – chilled', 'Frozen fish – Kariba kapenta', 'Fresh fruit – citrus'],
  bulk: ['Maize grain – bulk', 'Coal – 30t', 'Lithium concentrate', 'Chrome ore', 'Wheat – bulk', 'Sugar – 50kg bags'],
  passengers: ['Staff shuttle – 52 pax', 'Intercity passenger service', 'Mine staff transfer'],
  containers: ['20ft container – imports via Beitbridge', '40ft container – export cargo', 'Empty container repositioning'],
  hazardous: ['Industrial chemicals – UN1789', 'Fertiliser – AN 34.5%'],
  equipment: ['Mining equipment – crusher parts', 'Generator & spares', 'Agricultural implements', 'Telecoms tower materials'],
}

export const DELAY_REASONS = [
  'Border congestion at Beitbridge',
  'Tyre blowout – roadside repair',
  'Road works on A5 – single lane',
  'Heavy rain / flooded low-level bridge',
  'Police roadblock inspection',
  'Customer offloading queue',
  'Mechanical fault – cooling system',
  'Loading delay at depot',
]

export const STREETS_HRE = ['Samora Machel Ave', 'Seke Rd', 'Simon Mazorodze Rd', 'Borrowdale Rd', 'Lytton Rd', 'Enterprise Rd', 'Airport Rd', 'Mutare Rd', 'Chiremba Rd']
