import { Injectable } from '@nestjs/common';
import { Observable, Subject } from 'rxjs';

function minutesAgo(m: number) { return Date.now() - m * 60_000; }

type ServiceItem = {
  name: string;
  category: 'internal' | 'external';
  status: 'up' | 'degraded' | 'down';
  lastChecked: number;
  location?: string;
  vendor?: string;
};
type LogItem = { service: string; level: 'info' | 'warn' | 'error'; message: string; timestamp: number; };

@Injectable()
export class MonitoringService {
  private services: ServiceItem[] = [
    { name: 'API Servers', category: 'internal', status: 'up', lastChecked: minutesAgo(12), location: 'eu-west-1' },
    { name: 'Live Investor', category: 'internal', status: 'degraded', lastChecked: minutesAgo(7), location: 'eu-west-1' },
    { name: 'Live Admin', category: 'internal', status: 'up', lastChecked: minutesAgo(8), location: 'eu-west-1' },
    { name: 'Web Servers', category: 'internal', status: 'up', lastChecked: minutesAgo(3), location: 'eu-west-1' },
    { name: 'Live website', category: 'internal', status: 'up', lastChecked: minutesAgo(3), location: 'eu-west-1' },
    { name: 'Live Web-app', category: 'internal', status: 'down', lastChecked: minutesAgo(2), location: 'eu-west-1' },
    { name: 'Onfido Services', category: 'external', status: 'up', lastChecked: minutesAgo(14), vendor: 'Onfido' },
    { name: 'Mangopay Services', category: 'external', status: 'up', lastChecked: minutesAgo(14), vendor: 'Mangopay' },
    { name: 'Hubspot Services', category: 'external', status: 'up', lastChecked: minutesAgo(10), vendor: 'Hubspot' },
    { name: 'Twiillo Services', category: 'external', status: 'up', lastChecked: minutesAgo(9), vendor: 'Twilio' },
    { name: 'Sendgrid Services', category: 'external', status: 'degraded', lastChecked: minutesAgo(5), vendor: 'SendGrid' },
    { name: 'DocuSIgn Services', category: 'external', status: 'up', lastChecked: minutesAgo(22), vendor: 'DocuSign' },
    { name: 'MongoDB services', category: 'internal', status: 'up', lastChecked: minutesAgo(4), location: 'atlas' },
    { name: 'Vercel Services', category: 'external', status: 'up', lastChecked: minutesAgo(11), vendor: 'Vercel' },
  ];
  private logs: LogItem[] = [
    { service: 'API Servers', level: 'info', message: 'Health check OK: 200 in 120ms', timestamp: Date.now() - 12 * 60_000 },
    { service: 'Live Investor', level: 'warn', message: 'Elevated error rate: 2.1%', timestamp: Date.now() - 7 * 60_000 },
    { service: 'Live Web-app', level: 'error', message: 'Ping failed: timeout', timestamp: Date.now() - 2 * 60_000 },
    { service: 'Sendgrid Services', level: 'warn', message: 'Rate-limited on email API', timestamp: Date.now() - 5 * 60_000 },
    { service: 'DocuSIgn Services', level: 'info', message: 'Webhook delivered', timestamp: Date.now() - 22 * 60_000 },
    { service: 'MongoDB services', level: 'info', message: 'Replica set healthy', timestamp: Date.now() - 4 * 60_000 },
    { service: 'Web Servers', level: 'info', message: 'Response time normal: p95=220ms', timestamp: Date.now() - 3 * 60_000 },
    { service: 'Twiillo Services', level: 'info', message: 'SMS sent successfully', timestamp: Date.now() - 9 * 60_000 },
    { service: 'Vercel Services', level: 'info', message: 'Deployment succeeded', timestamp: Date.now() - 11 * 60_000 },
    { service: 'Live Admin', level: 'info', message: 'Health check OK', timestamp: Date.now() - 8 * 60_000 },
  ];

  private subject = new Subject<MessageEvent>();

  constructor() {}

  getServices() { return this.services; }
  getLogsSorted() { return [...this.logs].sort((a, b) => b.timestamp - a.timestamp); }
  events$(): Observable<MessageEvent> { return this.subject.asObservable(); }
}
