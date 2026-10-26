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
                <span className="coming-header-name">VICTORIA GARMENTS</span>
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

            <section className="coming-brands" aria-labelledby="coming-brands-title">
                <div className="coming-brands-heading">
                    <span aria-hidden="true" />
                    <h2 id="coming-brands-title">Our brands</h2>
                    <span aria-hidden="true" />
                </div>
                <div className="coming-brand-grid">
                    <img src="/landing/brand-victoria-640.webp" alt="Victoria — Irresistible Fashion" width="640" height="256" />
                    <img src="/landing/brand-protrack-640.webp" alt="Pro Track — Power of Fashion" width="640" height="256" />
                </div>
            </section>

            <footer className="coming-footer">
                <span>© {new Date().getFullYear()} Victoria Garments</span>
                <span className="coming-footer-center">Thoughtfully made. Always.</span>
            </footer>
        </div>
    );
}
