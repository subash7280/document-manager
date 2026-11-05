import React from 'react';
import { FileQuestion } from 'lucide-react';
import Button from '../components/Button';
import EmptyState from '../components/EmptyState';

export default function NotFoundPage() {
  return (
    <main className="auth-page">
      <div className="ui-card" style={{ maxWidth: 480, width: '100%' }}>
        <EmptyState icon={FileQuestion} title="Page not found" action={<Button variant="primary" to="/">Go to documents</Button>}>
          The address may be mistyped, or the page has moved.
        </EmptyState>
      </div>
    </main>
  );
}
