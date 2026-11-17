import type { Branch, Department, Geofence, Role, User } from '@/types'
import { ROLE_SEEDS } from '@/config/permissions'

export const BRANCH_SEEDS: Branch[] = [
  { id: 'br-hre', code: 'HRE', name: 'Harare Head Office & Main Depot', city: 'Harare', type: 'head_office', address: '14 Gleneagles Rd, Msasa Industrial Area, Harare', lat: -17.8383, lng: 31.118, manager: 'Rudo Chigwedere', phone: '+263 242 486 100', email: 'harare@zambezifreight.co.zw', bayCapacity: 60, status: 'active' },
  { id: 'br-sou', code: 'HSD', name: 'Harare South Depot', city: 'Harare', type: 'depot', address: '22 Coventry Rd, Southerton, Harare', lat: -17.864, lng: 31.016, manager: 'Tonderai Mapfumo', phone: '+263 242 621 330', email: 'southerton@zambezifreight.co.zw', bayCapacity: 40, status: 'active' },
  { id: 'br-byo', code: 'BYO', name: 'Bulawayo Depot', city: 'Bulawayo', type: 'depot', address: '8 Sidojiwe Rd, Belmont Industrial, Bulawayo', lat: -20.175, lng: 28.553, manager: 'Sibusiso Ncube', phone: '+263 292 889 410', email: 'bulawayo@zambezifreight.co.zw', bayCapacity: 45, status: 'active' },
  { id: 'br-mut', code: 'MUT', name: 'Mutare Depot', city: 'Mutare', type: 'depot', address: '3 Fourth St, Sakubva Industrial, Mutare', lat: -18.985, lng: 32.655, manager: 'Tariro Makoni', phone: '+263 202 064 220', email: 'mutare@zambezifreight.co.zw', bayCapacity: 25, status: 'active' },
  { id: 'br-gwe', code: 'GWE', name: 'Gweru Depot', city: 'Gweru', type: 'depot', address: '41 Bryn Rd, Light Industrial Area, Gweru', lat: -19.46, lng: 29.8, manager: 'Elton Tshuma', phone: '+263 254 227 810', email: 'gweru@zambezifreight.co.zw', bayCapacity: 25, status: 'active' },
  { id: 'br-kwe', code: 'KWE', name: 'Kwekwe Depot', city: 'Kwekwe', type: 'depot', address: '12 Industrial Rd, Kwekwe', lat: -18.94, lng: 29.83, manager: 'Learnmore Hove', phone: '+263 255 223 140', email: 'kwekwe@zambezifreight.co.zw', bayCapacity: 18, status: 'active' },
  { id: 'br-msv', code: 'MSV', name: 'Masvingo Depot', city: 'Masvingo', type: 'depot', address: '5 Hughes St, Masvingo Industrial, Masvingo', lat: -20.07, lng: 30.84, manager: 'Chipo Mawere', phone: '+263 392 262 540', email: 'masvingo@zambezifreight.co.zw', bayCapacity: 22, status: 'active' },
  { id: 'br-chi', code: 'CHI', name: 'Chinhoyi Depot', city: 'Chinhoyi', type: 'depot', address: '19 Magamba Way, Chinhoyi', lat: -17.37, lng: 30.19, manager: 'Garikai Matsika', phone: '+263 677 22 410', email: 'chinhoyi@zambezifreight.co.zw', bayCapacity: 15, status: 'active' },
  { id: 'br-bbr', code: 'BBR', name: 'Beitbridge Border Depot', city: 'Beitbridge', type: 'border_post', address: 'Plot 7, Border Rd, Beitbridge', lat: -22.2217, lng: 29.99, manager: 'Admire Sithole', phone: '+263 286 22 540', email: 'beitbridge@zambezifreight.co.zw', bayCapacity: 35, status: 'active' },
  { id: 'br-wks', code: 'WKS', name: 'Central Workshop', city: 'Harare', type: 'workshop', address: '9 Willowvale Rd, Workington, Harare', lat: -17.848, lng: 31.02, manager: 'Cosmas Bvuma', phone: '+263 242 753 900', email: 'workshop@zambezifreight.co.zw', bayCapacity: 14, status: 'active' },
]

export const DEPARTMENT_SEEDS: Department[] = [
  { id: 'dep-ops', name: 'Operations', head: 'Rudo Chigwedere', headcount: 38, costCentre: 'CC-100', description: 'Route planning, trip execution and depot operations.' },
  { id: 'dep-dis', name: 'Dispatch & Control Room', head: 'Misheck Gwatidzo', headcount: 12, costCentre: 'CC-110', description: '24/7 dispatch, live tracking and customer ETAs.' },
  { id: 'dep-wks', name: 'Workshop & Maintenance', head: 'Cosmas Bvuma', headcount: 24, costCentre: 'CC-200', description: 'Preventive maintenance, repairs and inspections.' },
  { id: 'dep-fin', name: 'Finance', head: 'Memory Chitiyo', headcount: 9, costCentre: 'CC-300', description: 'Billing, accounts payable, budgeting and fleet cost control.' },
  { id: 'dep-saf', name: 'Safety, Health & Compliance', head: 'Dennis Kanyemba', headcount: 6, costCentre: 'CC-400', description: 'Incident management, driver coaching and regulatory compliance.' },
  { id: 'dep-hr', name: 'Human Resources', head: 'Ruvimbo Shumba', headcount: 5, costCentre: 'CC-500', description: 'Driver recruitment, training and employee relations.' },
  { id: 'dep-it', name: 'IT & Telematics', head: 'Obert Mlambo', headcount: 4, costCentre: 'CC-600', description: 'Telematics devices, systems and integrations.' },
  { id: 'dep-cs', name: 'Customer Service', head: 'Precious Nhamo', headcount: 7, costCentre: 'CC-700', description: 'Customer onboarding, tracking support and claims.' },
]

export const ROLES: Role[] = ROLE_SEEDS.map((r) => ({ ...r, builtIn: true }))

export function buildUsers(now: number): User[] {
  const d = (days: number) => new Date(now - days * 864e5).toISOString()
  const hours = (h: number) => new Date(now - h * 36e5).toISOString()
  const mk = (id: string, name: string, roleId: string, branchId: string, departmentId: string, status: User['status'], lastLogin: string | null, twoFactor = true): User => ({
    id,
    name,
    email: `${name.toLowerCase().replace(/[^a-z ]/g, '').replace(/ /g, '.')}@zambezifreight.co.zw`,
    phone: `+263 77 ${100 + ((name.charCodeAt(0) * 37 + name.length * 91) % 899)} ${1000 + ((name.charCodeAt(2) * 131 + name.charCodeAt(4) * 17) % 8999)}`,
    roleId,
    branchId,
    departmentId,
    status,
    lastLogin,
    twoFactor,
    createdAt: d(400),
  })
  return [
    mk('usr-01', 'Blessing Mwale', 'role-super', 'all', 'dep-it', 'active', hours(0.1)),
    mk('usr-02', 'Rudo Chigwedere', 'role-fleet', 'br-hre', 'dep-ops', 'active', hours(3)),
    mk('usr-03', 'Misheck Gwatidzo', 'role-dispatch', 'br-hre', 'dep-dis', 'active', hours(1)),
    mk('usr-04', 'Nokuthula Dube', 'role-dispatch', 'br-byo', 'dep-dis', 'active', hours(5)),
    mk('usr-05', 'Cosmas Bvuma', 'role-workshop', 'br-wks', 'dep-wks', 'active', hours(8)),
    mk('usr-06', 'Memory Chitiyo', 'role-finance', 'all', 'dep-fin', 'active', hours(26)),
    mk('usr-07', 'Dennis Kanyemba', 'role-safety', 'all', 'dep-saf', 'active', hours(12)),
    mk('usr-08', 'Sibusiso Ncube', 'role-fleet', 'br-byo', 'dep-ops', 'active', hours(30)),
    mk('usr-09', 'Tariro Makoni', 'role-viewer', 'br-mut', 'dep-ops', 'active', d(4), false),
    mk('usr-10', 'Obert Mlambo', 'role-super', 'all', 'dep-it', 'active', d(2)),
    mk('usr-11', 'Precious Nhamo', 'role-viewer', 'all', 'dep-cs', 'invited', null, false),
    mk('usr-12', 'Elton Tshuma', 'role-dispatch', 'br-gwe', 'dep-dis', 'disabled', d(75), false),
  ]
}

export const CURRENT_USER_ID = 'usr-01'

export function buildGeofences(): Geofence[] {
  const depots: Geofence[] = BRANCH_SEEDS.map((b) => ({
    id: `geo-${b.code.toLowerCase()}`,
    name: `${b.name.replace(' & Main Depot', '')} yard`,
    kind: 'depot',
    lat: b.lat,
    lng: b.lng,
    radiusM: b.type === 'head_office' ? 700 : 500,
    branchId: b.id,
    alertOnEnter: true,
    alertOnExit: true,
  }))
  const others: Geofence[] = [
    { id: 'geo-cus-1', name: 'Graniteside Distribution Hub', kind: 'customer', lat: -17.8575, lng: 31.045, radiusM: 450, alertOnEnter: true, alertOnExit: false },
    { id: 'geo-cus-2', name: 'Kopje Retail DC – Workington', kind: 'customer', lat: -17.8525, lng: 31.0285, radiusM: 400, alertOnEnter: true, alertOnExit: false },
    { id: 'geo-cus-3', name: 'Matabele Cement Plant', kind: 'customer', lat: -20.18, lng: 28.57, radiusM: 500, alertOnEnter: true, alertOnExit: true },
    { id: 'geo-cus-4', name: 'Great Dyke Mining Yard', kind: 'customer', lat: -18.915, lng: 29.835, radiusM: 600, alertOnEnter: true, alertOnExit: true },
    { id: 'geo-cus-5', name: 'Mutare Timber Mill', kind: 'customer', lat: -18.965, lng: 32.66, radiusM: 450, alertOnEnter: true, alertOnExit: false },
    { id: 'geo-bor-1', name: 'Beitbridge Border Post', kind: 'border', lat: -22.226, lng: 29.985, radiusM: 1500, alertOnEnter: true, alertOnExit: true },
    { id: 'geo-res-1', name: 'Harare CBD – heavy vehicle restriction', kind: 'restricted', lat: -17.8292, lng: 31.0522, radiusM: 1400, alertOnEnter: true, alertOnExit: false },
    { id: 'geo-res-2', name: 'Bulawayo CBD – heavy vehicle restriction', kind: 'restricted', lat: -20.15, lng: 28.5833, radiusM: 1100, alertOnEnter: true, alertOnExit: false },
    { id: 'geo-cit-1', name: 'Gweru service area', kind: 'city', lat: -19.45, lng: 29.8167, radiusM: 3500, alertOnEnter: false, alertOnExit: false },
  ]
  return [...depots, ...others]
}
