'use client';
import { useState } from 'react';
import { PageTitle, Segmented, Empty } from '@/components/ui';
import { useAuth, can } from '@/sync/auth';
import { UsersAdmin } from '@/components/admin/UsersAdmin';
import { TeamsAdmin } from '@/components/admin/TeamsAdmin';
import { SettingsAdmin } from '@/components/admin/SettingsAdmin';
import { DataSourcesAdmin } from '@/components/admin/DataSourcesAdmin';
import { ManualEntry } from '@/components/admin/ManualEntry';
import { RotationAdmin } from '@/components/admin/RotationAdmin';
import { RawDataAdmin } from '@/components/admin/RawDataAdmin';
import { ExportsAdmin } from '@/components/admin/ExportsAdmin';
import { AuditAdmin } from '@/components/admin/AuditAdmin';
import { BrandingAdmin } from '@/components/admin/BrandingAdmin';

type Tab = 'data' | 'manual' | 'rotation' | 'raw' | 'teams' | 'users' | 'settings' | 'branding' | 'exports' | 'audit';

const ALL: { value: Tab; label: string; admin: boolean }[] = [
  { value: 'data', label: 'Data sources', admin: true },
  { value: 'manual', label: 'Manual entry', admin: true },
  { value: 'rotation', label: 'Scout rotation', admin: false },
  { value: 'raw', label: 'Raw scouting', admin: true },
  { value: 'teams', label: 'Teams & aliases', admin: true },
  { value: 'users', label: 'Users & roles', admin: true },
  { value: 'settings', label: 'Settings', admin: true },
  { value: 'branding', label: 'Branding', admin: true },
  { value: 'exports', label: 'Exports', admin: false },
  { value: 'audit', label: 'Audit log', admin: true },
];

export default function AdminPage() {
  const auth = useAuth();
  const isAdmin = can.admin(auth.role);
  const tabs = ALL.filter((t) => isAdmin || (!t.admin && can.manageRotation(auth.role)));
  const [tab, setTab] = useState<Tab>(isAdmin ? 'data' : 'rotation');
  if (!tabs.length) return <Empty title="Admins only">Ask an admin to promote your account.</Empty>;
  const active = tabs.some((t) => t.value === tab) ? tab : tabs[0].value;
  return (
    <div className="mx-auto max-w-5xl">
      <PageTitle sub={isAdmin ? 'Data, users, settings, audit' : 'Scouting lead tools'}>{isAdmin ? 'Admin' : 'Lead tools'}</PageTitle>
      <div className="scroll-x mb-4">
        <Segmented value={active} onChange={setTab} options={tabs.map(({ value, label }) => ({ value, label }))} />
      </div>
      {active === 'data' && <DataSourcesAdmin />}
      {active === 'manual' && <ManualEntry />}
      {active === 'rotation' && <RotationAdmin />}
      {active === 'raw' && <RawDataAdmin />}
      {active === 'teams' && <TeamsAdmin />}
      {active === 'users' && <UsersAdmin />}
      {active === 'settings' && <SettingsAdmin />}
      {active === 'branding' && <BrandingAdmin />}
      {active === 'exports' && <ExportsAdmin />}
      {active === 'audit' && <AuditAdmin />}
    </div>
  );
}
