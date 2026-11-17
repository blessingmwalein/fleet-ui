import { Banknote, Fuel, Gauge, PackageCheck, Route, ShieldAlert, Truck, UserRound, Wallet, Wrench } from 'lucide-react'
import type { ReportMeta } from './types'

export const REPORT_GROUPS: ReportMeta['group'][] = ['Operations', 'Fleet', 'Finance', 'Safety & people']

/** Presentation metadata for the report centre and navigation (computation lives in the spec of the same slug). */
export const REPORTS: ReportMeta[] = [
  {
    slug: 'fleet-utilisation', title: 'Fleet utilisation', short: 'Utilisation', group: 'Operations', icon: Gauge,
    description: 'How much of the fleet is working: active days, driving hours, distance and workshop downtime by vehicle, depot or period.',
    answers: ['Which vehicles are idle?', 'Utilisation trend', 'Driving vs idle hours'],
  },
  {
    slug: 'trip-performance', title: 'Trip performance', short: 'Trips', group: 'Operations', icon: Route,
    description: 'Completion, punctuality and planned-vs-actual distance and time, with delay causes by route, depot or cargo.',
    answers: ['Completion rate', 'Delays by reason', 'Planned vs actual'],
  },
  {
    slug: 'delivery-performance', title: 'Delivery performance', short: 'Deliveries', group: 'Operations', icon: PackageCheck,
    description: 'On-time delivery, proof-of-delivery capture and shipment exceptions by customer, destination and cargo type.',
    answers: ['On-time by customer', 'POD & condition', 'Exception register'],
  },
  {
    slug: 'vehicle-performance', title: 'Vehicle performance', short: 'Vehicles', group: 'Fleet', icon: Truck,
    description: 'Distance, trips, revenue, cost per km, margin and availability for every vehicle, category and depot.',
    answers: ['Cost per km', 'Margin by vehicle', 'Availability'],
  },
  {
    slug: 'fuel-consumption', title: 'Fuel consumption', short: 'Fuel', group: 'Fleet', icon: Fuel,
    description: 'Litres, spend, L/100 km versus rated consumption, price trends by station, and flagged fuel anomalies.',
    answers: ['L/100 km vs rated', 'Spend by station', 'Flagged fills'],
  },
  {
    slug: 'maintenance-costs', title: 'Maintenance costs', short: 'Maintenance', group: 'Fleet', icon: Wrench,
    description: 'Workshop spend by vehicle, work-order type and provider; downtime, preventive share and the costliest jobs.',
    answers: ['Cost by provider', 'Downtime', 'Preventive vs reactive'],
  },
  {
    slug: 'operating-expenses', title: 'Operating expenses', short: 'Expenses', group: 'Finance', icon: Wallet,
    description: 'All operating spend by category, depot, vehicle, supplier and payment method, with budget comparison.',
    answers: ['Spend vs budget', 'Top suppliers', 'Pending approvals'],
  },
  {
    slug: 'financial-performance', title: 'Financial performance', short: 'Financials', group: 'Finance', icon: Banknote,
    description: 'Revenue, operating cost and margin over time, invoicing and collections, and receivables ageing.',
    answers: ['Margin trend', 'Revenue by customer', 'Overdue receivables'],
  },
  {
    slug: 'driver-performance', title: 'Driver performance', short: 'Drivers', group: 'Safety & people', icon: UserRound,
    description: 'Trips, on-time %, safety score, event rates, incidents and fuel efficiency per driver, depot or safety band.',
    answers: ['Best / worst drivers', 'Safety bands', 'Event rate'],
  },
  {
    slug: 'safety-incidents', title: 'Safety & incidents', short: 'Safety', group: 'Safety & people', icon: ShieldAlert,
    description: 'Incidents and telematics safety events by driver, vehicle, type and severity, normalised per km, with the incident register.',
    answers: ['Incident trend', 'Events per 1,000 km', 'Estimated losses'],
  },
]

export const REPORT_BY_SLUG = Object.fromEntries(REPORTS.map((r) => [r.slug, r])) as Record<string, ReportMeta>
