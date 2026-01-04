'use client'

import { useGetUserEmails } from "@/features/use-get-user-email"

const Email = () => {
  const { data, isLoading, isError } = useGetUserEmails();

  console.table(data);

  if (isLoading) {
    return (
      <div className="flex justify-center items-center p-8">
        <p className="text-gray-600">Loading emails...</p>
      </div>
    );
  }

  if (isError) {
    return (
      <div className="flex justify-center items-center p-8">
        <p className="text-red-600">Error loading emails. Please try again.</p>
      </div>
    );
  }

  if (!data?.emails || data.emails.length === 0) {
    return (
      <div className="flex justify-center items-center p-8">
        <p className="text-gray-600">No emails found.</p>
      </div>
    );
  }

  return (
    <div className="w-full max-w-4xl space-y-2">
      {data.emails.map((email) => (
        <div 
          key={email.id} 
          className={`border p-4 rounded shadow hover:shadow-md transition-shadow ${
            email.isRead ? 'bg-gray-50' : 'bg-white'
          }`}
        >
          <div className="flex justify-between items-start mb-2">
            <p className={`font-bold text-lg ${!email.isRead ? 'text-gray-900' : 'text-gray-700'}`}>
              {email.subject || '(No Subject)'}
            </p>
            <span className="text-xs text-gray-500 ml-4">{email.date}</span>
          </div>
          
          <div className="flex justify-between items-center mb-2">
            <p className="text-sm text-gray-600">From: {email.from}</p>
            <p className="text-xs text-gray-500">To: {email.to}</p>
          </div>
          
          {email.snippet && (
            <p className="text-sm text-gray-500 line-clamp-2 mb-2">{email.snippet}</p>
          )}
          
          {email.labels.length > 0 && (
            <div className="flex flex-wrap gap-1 mt-2">
              {email.labels.map((label, index) => (
                <span 
                  key={index}
                  className="text-xs px-2 py-1 bg-blue-100 text-blue-700 rounded-full"
                >
                  {label}
                </span>
              ))}
            </div>
          )}
        </div>
      ))}
    </div>
  );
}

export default Email