import { useEffect } from 'react';
import './ComingSoonPage.css';

export default function ComingSoonPage() {
    useEffect(() => {
        const previousTitle = document.title;
        document.title = 'We’ll be back soon — Victoria Garments';
        return () => { document.title = previousTitle; };
    }, []);

    return (
        <div className="coming-soon">
            <header className="coming-header">
                <div className="coming-brands">
                    <img className="coming-victoria-logo" src="/victoria-logo-mark-light.png" alt="Victoria — Irresistible Fashion" width="220" height="46" />
                    <span className="coming-brand-divider" aria-hidden="true" />
                    <img className="coming-protrack-logo" src="/landing/brand-protrack-640.webp" alt="Pro Track — Power of Fashion" width="150" height="60" />
                </div>
                <span className="coming-status"><span aria-hidden="true" /> A new chapter is on its way</span>
            </header>

            <main className="coming-main">
                <section className="coming-copy" aria-labelledby="coming-title">
                    <p className="coming-eyebrow">VICTORIA GARMENTS <span aria-hidden="true">/</span> TIRUPPUR</p>
                    <h1 id="coming-title">Good things<br />take a little<br /><span>more care.</span></h1>
                    <div className="coming-message">
                        <h2>We’ll be back soon. Better than ever.</h2>
                        <p>We’re giving our website a thoughtful refresh.<br className="coming-desktop-break" /> A new look, the same attention to every detail.</p>
                    </div>
                    <p className="coming-note"><span aria-hidden="true">✳</span> Thank you for being part of our story.</p>
                </section>

                <div className="coming-art" aria-hidden="true">
                    <div className="coming-orbit coming-orbit-one" />
                    <div className="coming-orbit coming-orbit-two" />
                    <div className="coming-thread" />
                    <div className="coming-label">
                        <div className="coming-eyelet" />
                        <span className="coming-label-small">THE NEXT CHAPTER</span>
                        <img src="/victoria-leaf.png" alt="" />
                        <span className="coming-label-title">Made with care.<br />Worth the wait.</span>
                        <div className="coming-label-rule" />
                        <span className="coming-label-small">VICTORIA GARMENTS</span>
                        <span className="coming-label-location">Tiruppur, India</span>
                        <span className="coming-label-number">EST. IN CRAFT · REIMAGINED WITH CARE</span>
                    </div>
                    <span className="coming-art-caption">SOMETHING BEAUTIFUL IS TAKING SHAPE</span>
                </div>
            </main>

            <footer className="coming-footer">
                <span>© {new Date().getFullYear()} Victoria Garments</span>
                <span className="coming-footer-center">Thoughtfully made. Always.</span>
            </footer>
        </div>
    );
}
