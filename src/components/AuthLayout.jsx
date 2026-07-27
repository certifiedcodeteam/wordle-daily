import React from "react";
import { Link } from "react-router-dom";

export default function AuthLayout({ icon: Icon, title, subtitle, footer, children }) {
  return (
    <div className="min-h-[100dvh] flex items-center justify-center bg-[#f7f7f4] px-4 py-10">
      <div className="w-full max-w-md">
        <div className="text-center mb-8">
          <Link to="/" className="inline-flex items-center gap-2 mb-7 text-xl font-extrabold text-[#20201e] hover:opacity-75">
            <span className="wordmark-grid" aria-hidden="true"><i /><i /><i /><i /></span>
            Wordle Daily
          </Link>
          <div className="flex items-center justify-center w-12 h-12 rounded-md bg-[#20201e] mx-auto mb-4">
            <Icon className="w-7 h-7 text-primary-foreground" aria-hidden="true" />
          </div>
          <h1 className="text-3xl font-bold text-[#20201e]">{title}</h1>
          {subtitle && <p className="text-muted-foreground mt-2">{subtitle}</p>}
        </div>
        <div className="bg-white rounded-md shadow-sm border border-border p-8">
          {children}
        </div>
        {footer && (
          <p className="text-center text-sm text-muted-foreground mt-6">{footer}</p>
        )}
      </div>
    </div>
  );
}
