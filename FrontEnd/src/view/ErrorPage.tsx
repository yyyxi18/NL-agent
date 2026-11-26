import { AlertTriangle, ArrowLeft } from 'lucide-react';
import { Link, useRouteError } from 'react-router';

function ErrorPage() {
  const error = useRouteError() as { statusText?: string; message?: string };

  return (
    <section className="coming-soon-page">
      <div className="coming-icon" style={{ borderColor: '#f0d0cc', background: '#fff5f5', color: '#c0564a' }}>
        <AlertTriangle size={22} />
      </div>
      <div className="section-kicker">ERROR</div>
      <h1>發生錯誤</h1>
      <p>{error?.statusText || error?.message || '頁面載入時發生未預期的錯誤。'}</p>
      <Link className="button button-secondary" to="/"><ArrowLeft size={16} />回到首頁</Link>
    </section>
  );
}

export default ErrorPage;
