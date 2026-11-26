import { useRef, useState } from 'react';

import { Button } from './components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from './components/ui/card';
import { Notice } from './components/ui/notice';
import { requestJson } from './lib/api';
import { useNotice } from './lib/use-notice';

// #298 Settings card: download every table as one backup file, and restore such a file into an empty database.
// The file never holds the KakaoTalk tokens or other secrets (the server leaves those tables out).

const backupPath = '/api/backup';

type Restored = { restored: Record<string, number>; total: number };

export function BackupSettings() {
  const notice = useNotice();
  const { error: showError, status: showStatus, clear } = notice;
  const [busy, setBusy] = useState(false);
  const input = useRef<HTMLInputElement>(null);

  const restore = async (file: File) => {
    clear();
    let body: unknown;
    try {
      body = JSON.parse(await file.text());
    } catch {
      showError('This file is not a backup file. Choose a file downloaded from this page');
      return;
    }
    setBusy(true);
    try {
      const result = await requestJson<Restored>(`${backupPath}/restore`, { method: 'POST', body });
      showStatus(
        `Restored ${result.total.toLocaleString('en-US')} rows from ${file.name}. Reload the pages to see them`,
      );
    } catch (cause) {
      showError(cause, 'Could not restore the backup');
    } finally {
      setBusy(false);
      // The same file can be chosen again after a refusal.
      if (input.current) input.current.value = '';
    }
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle asHeading="h2">Backup and restore</CardTitle>
        <CardDescription>
          One file with your entries, rules, fixed costs, assets, goals and mock accounts. KakaoTalk
          sign-in tokens are never in it.
        </CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        <Notice id="backup-notice" notice={notice.notice} />
        <div className="flex flex-col gap-2">
          <p className="text-body-sm font-medium">Download</p>
          <div>
            <Button asChild variant="outline">
              <a href={backupPath} download>
                Download backup
              </a>
            </Button>
          </div>
        </div>
        <div className="flex flex-col gap-2">
          <label htmlFor="backup-file" className="text-body-sm font-medium">
            Restore from a backup file
          </label>
          <p className="text-caption text-muted-foreground">
            A restore only works in an empty database: if there is already data, nothing is changed
            and you are told so.
          </p>
          <input
            id="backup-file"
            ref={input}
            type="file"
            accept="application/json,.json"
            disabled={busy}
            className="text-body-sm"
            onChange={(event) => {
              const file = event.target.files?.[0];
              if (file) void restore(file);
            }}
          />
        </div>
      </CardContent>
    </Card>
  );
}
