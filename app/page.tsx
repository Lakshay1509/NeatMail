'use client';

import { UserButton, useUser } from '@clerk/nextjs';
import { useState } from 'react';

export default function Home() {
  const { user } = useUser();
  const [emails, setEmails] = useState<any[]>([]);
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState('');

  const handleClassifyEmails = async () => {
    setLoading(true);
    setResult('');
    try {
      const response = await fetch('/api/email/classify-email');
      const data = await response.json();
      
      if (!response.ok) {
        throw new Error(data.error || 'Failed to classify emails');
      }
      
      setEmails(data.emails || []);
      setResult(data.message);
    } catch (error: any) {
      console.error('Error:', error);
      setResult(`Error: ${error.message || 'Failed to classify emails'}`);
      setEmails([]);
    }
    setLoading(false);
  };

  const handleActivateAutoLabel = async () => {
  
  try {
    // Save token first
    await fetch('/api/user/store-token', { method: 'POST' });
    
    // Activate watch
    const response = await fetch('/api/activate-watch', { method: 'POST' });
    const data = await response.json();
    
    if (data.success) {
      alert('🎉 Auto-labeling activated! New emails will be labeled automatically.');
    }
  } catch (error) {
    alert('Failed to activate');
  }
  
};

  return (
    <main className="flex min-h-screen flex-col items-center p-24">
      <div className="w-full max-w-4xl flex justify-between items-center mb-8">
        <h1 className="text-4xl font-bold">Gmail Classifier</h1>
        <UserButton />
      </div>

      <p className="mb-8">Logged in as {user?.primaryEmailAddress?.emailAddress}</p>
      
      <button
        onClick={handleClassifyEmails}
        disabled={loading}
        className="bg-green-500 text-white px-6 py-3 rounded-lg disabled:opacity-50 mb-8"
      >
        {loading ? 'Processing...' : 'Classify Recent Emails'}
      </button>

      {result && <p className="mb-4 text-lg font-semibold">{result}</p>}

      <div className="w-full max-w-4xl space-y-2">
        {emails.map((email: any) => (
          <div key={email.id} className="border p-4 rounded bg-white shadow">
            <p className="font-bold">{email.subject}</p>
            <p className="text-sm text-gray-600">{email.from}</p>
            <p className="text-sm text-blue-600 mt-2">Label: {email.label}</p>
          </div>
        ))}
      </div>
      <button
  onClick={handleActivateAutoLabel}
  className="bg-purple-500 text-white px-6 py-3 rounded-lg"
>
  Activate Auto-Labeling
</button>

    </main>
  );
}
