import { ArrowLeft, Sparkles } from 'lucide-react';
import { Link } from 'react-router';

function ComingSoon({ title }: { title: string }) {
  return (
    <section className="coming-soon-page">
      <div className="coming-icon"><Sparkles size={22} /></div>
      <div className="section-kicker">ON THE ROADMAP</div>
      <h1>{title}</h1>
      <p>這項功能已列入 NL-agent 規劃，目前尚未開始開發。</p>
      <Link className="button button-secondary" to="/"><ArrowLeft size={16} />回到首頁</Link>
    </section>
  );
}

export default ComingSoon;
