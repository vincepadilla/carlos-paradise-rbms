import type { ReactNode } from "react";
import { Link } from "react-router";

function AuthLogo({ light = false }: { light?: boolean }) {
    return (
        <Link
            to="/"
            aria-label="Carlos Paradise home"
            className={`inline-flex items-center gap-2.5 ${light ? "text-white" : "text-brown"}`}
        >
            <img
                src="/assets/carlos-paradise-logo.jpg"
                alt=""
                className="size-[38px] rounded-full border-2 border-current object-cover"
            />
            <span className="flex flex-col leading-none">
                <span className="font-display text-[17px]">Carlos</span>
                <strong className="mt-1 text-[11px] uppercase tracking-[.15em]">
                    Paradise
                </strong>
            </span>
        </Link>
    );
}

export default function AuthLayout({
    children,
    edgeToEdgeImage = false,
}: {
    children: ReactNode;
    edgeToEdgeImage?: boolean;
}) {
    return (
        <main className="grid min-h-screen grid-cols-[1.05fr_.95fr] overflow-hidden bg-paper font-sans text-sm text-ink max-[819px]:block">
            <section
                aria-label="Carlos Paradise villa"
                className={`relative max-[819px]:m-0 max-[819px]:h-[220px] ${
                    edgeToEdgeImage
                        ? "m-0 overflow-visible after:pointer-events-none after:absolute after:inset-y-0 after:right-[-80px] after:z-20 after:w-[280px] after:bg-[linear-gradient(90deg,rgba(74,50,38,0)_0%,rgba(74,50,38,.1)_22%,rgba(255,253,248,.55)_45%,rgba(255,253,248,.9)_62%,#fffdf8_72%,#fffdf8_100%)] max-[819px]:overflow-hidden max-[819px]:after:hidden"
                        : "m-[18px] overflow-hidden"
                }`}
            >
                <img
                    src="/assets/villa-exterior.jpg"
                    alt="Carlos Paradise private villa at dusk"
                    className="absolute inset-0 size-full object-cover"
                    fetchPriority="high"
                />
                <div className="absolute inset-0 bg-[linear-gradient(0deg,rgba(32,24,18,.7),transparent_65%)]" />
                <div className="relative z-10 flex h-full min-h-[650px] flex-col justify-between p-9 text-white max-[819px]:min-h-0 max-[819px]:p-[25px]">
                    <AuthLogo light />
                    {edgeToEdgeImage ? (
                        <blockquote className="relative w-full max-w-[540px] overflow-hidden rounded-[18px] border border-white/20 bg-[linear-gradient(135deg,rgba(35,27,21,.82),rgba(74,50,38,.68))] px-8 py-7 shadow-[0_22px_55px_rgba(22,16,11,.28)] backdrop-blur-[10px] before:absolute before:inset-y-0 before:left-0 before:w-1 before:bg-gold max-[819px]:max-w-full max-[819px]:rounded-xl max-[819px]:px-5 max-[819px]:py-4">
                            <span
                                aria-hidden="true"
                                className="absolute right-5 top-0 font-display text-[86px] leading-none text-gold/20 max-[819px]:text-[64px]"
                            >
                                &ldquo;
                            </span>
                            <span className="relative block font-display text-[clamp(1.8rem,3vw,2.65rem)] font-normal leading-[1.08] tracking-[-.02em] max-[819px]:text-[24px]">
                                Ain&apos;t your ordinary villa.
                            </span>
                            <span className="relative mt-2 block max-w-[430px] text-[clamp(.95rem,1.25vw,1.08rem)] font-medium leading-relaxed text-[#f4eadb] max-[819px]:mt-1 max-[819px]:text-[13px]">
                                No stress, just memories that will fill ya.
                            </span>
                            <footer className="relative mt-5 flex items-center gap-3 text-[10px] font-bold uppercase tracking-[.2em] text-sand max-[819px]:mt-3">
                                <span className="h-px w-8 bg-gold" aria-hidden="true" />
                                Carlos Paradise
                            </footer>
                        </blockquote>
                    ) : (
                        <blockquote className="w-fit max-w-[90%] bg-[#33291f] px-[22px] py-[18px] font-display text-[clamp(1.7rem,3vw,2.7rem)] font-normal leading-[1.2] max-[819px]:max-w-full max-[819px]:px-[15px] max-[819px]:py-3 max-[819px]:text-[23px]">
                        “Ain&apos;t your ordinary villa!
                        <br />
                        No stress, just memories that will fill ya!”
                        </blockquote>
                    )}
                </div>
            </section>
            <section className="relative z-30 flex flex-col justify-center px-[7vw] py-[25px] max-[819px]:px-5 max-[819px]:pb-[50px]">
                <Link
                    to="/"
                    className="mb-[25px] w-fit text-muted transition-colors hover:text-brown focus-visible:outline-2 focus-visible:outline-gold"
                >
                    ← Back to home
                </Link>
                <div className="mx-auto my-auto w-full max-w-[460px]">
                    <div className="mb-[50px] max-[819px]:hidden">
                        <AuthLogo />
                    </div>
                    {children}
                </div>
            </section>
        </main>
    );
}
