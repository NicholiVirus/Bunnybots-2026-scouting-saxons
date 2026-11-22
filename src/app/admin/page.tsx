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

type Tab = 'data' | 'manual' | 'rotation' | 'teams' | 'users' | 'settings';

export default function AdminPage() {
  const auth = useAuth();
  const [tab, setTab] = useState<Tab>('data');
  if (!can.admin(auth.role)) return <Empty title="Admins only">Ask an admin to promote your account.</Empty>;
  return (
    <div className="mx-auto max-w-5xl">
      <PageTitle sub="Teams, users, data sources, settings">Admin</PageTitle>
      <div className="scroll-x mb-4">
        <Segmented
          value={tab}
          onChange={setTab}
          options={[
            { value: 'data', label: 'Data sources' },
            { value: 'manual', label: 'Manual entry' },
            { value: 'rotation', label: 'Scout rotation' },
            { value: 'teams', label: 'Teams & aliases' },
            { value: 'users', label: 'Users & roles' },
            { value: 'settings', label: 'Settings' },
          ]}
        />
      </div>
      {tab === 'data' && <DataSourcesAdmin />}
      {tab === 'manual' && <ManualEntry />}
      {tab === 'rotation' && <RotationAdmin />}
      {tab === 'teams' && <TeamsAdmin />}
      {tab === 'users' && <UsersAdmin />}
      {tab === 'settings' && <SettingsAdmin />}
    </div>
  );
}
