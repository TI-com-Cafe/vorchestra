import Layout from '@theme/Layout';
import Link from '@docusaurus/Link';

const features = [
  {
    title: 'Environment inventory',
    text: 'Scan local workspaces, adopt existing virtual environments, detect stale records and keep a fast local SQLite cache.',
  },
  {
    title: 'Health and repair',
    text: 'Score each environment, explain risk signals and guide repairs such as missing pip, missing tools, stale entries and rebuilds.',
  },
  {
    title: 'Package Studio',
    text: 'Inspect packages, sizes, dependency trees, graphs, upgrade previews, why-installed chains and multiple install sources.',
  },
  {
    title: 'Project-first workflows',
    text: 'Group environments by project root and operate from manifests, lockfiles, VS Code settings, Docker files and .env files.',
  },
  {
    title: 'Security and hygiene',
    text: 'Run pip-audit, metadata hygiene checks, suspicious-name hints, license summaries and CycloneDX SBOM export.',
  },
  {
    title: 'Local-first operations',
    text: 'Run heavy scans as cancellable background jobs without telemetry, cloud accounts or background data collection.',
  },
];

const screenshots = [
  {src: '/vorchestra/img/screenshots/vorchestra-1.png', title: 'Workspace inventory'},
  {src: '/vorchestra/img/screenshots/vorchestra-2.png', title: 'Studio overview'},
  {src: '/vorchestra/img/screenshots/vorchestra-3.png', title: 'Library manifest'},
];

function FeatureGrid() {
  return (
    <div className="featureGrid">
      {features.map((feature) => (
        <article className="featureCard" key={feature.title}>
          <h3>{feature.title}</h3>
          <p>{feature.text}</p>
        </article>
      ))}
    </div>
  );
}

export default function Home() {
  return (
    <Layout
      title="Local-first Python environment orchestration"
      description="VOrchestra is a local-first desktop control center for Python virtual environment inventory, diagnostics, repair, cleanup, security and project operations.">
      <header className="heroBanner">
        <div className="container heroGrid">
          <div>
            <p className="eyebrow">Local-first · Python environments · Repairable workflows</p>
            <div className="heroWordmark">
              <img src="/vorchestra/img/vorchestra-mark.svg" alt="VOrchestra" />
              <span>VOrchestra</span>
            </div>
            <h1 className="heroTitle">Orchestrate every Python environment on your machine.</h1>
            <p className="heroLead">
              VOrchestra turns scattered venv folders into a local command center for inventory,
              diagnostics, repair, cleanup, security, dependency analysis and project operations.
            </p>
            <div className="heroActions">
              <Link className="voButton voButtonPrimary" to="/docs/start/quickstart">
                Start in 5 minutes
              </Link>
              <Link className="voButton voButtonSecondary" to="/docs/product/overview">
                Explore product
              </Link>
              <Link className="voButton voButtonSecondary" to="/docs/community/roadmap">
                Open roadmap
              </Link>
            </div>
          </div>
          <aside className="heroCard">
            <p className="eyebrow">Current release · 0.1.0</p>
            <strong>One desktop surface for inventory, repair, cleanup and security.</strong>
            <p>
              Build from source today. Binary releases, screenshots and packaged installers are the
              next release milestone.
            </p>
            <div className="pillRow">
              <span>Tauri desktop</span>
              <span>pip + uv</span>
              <span>Conda/Pixi read-only</span>
              <span>No telemetry</span>
            </div>
          </aside>
        </div>
      </header>

      <main>
        <section className="sectionBlock sectionBlockTight">
          <div className="container">
            <div className="sectionHeading">
              <p className="eyebrow">Screenshots</p>
              <h2>A native desktop control center for local Python environments.</h2>
              <p>
                The interface is organized around workspace inventory, project context, Studio
                workflows, package operations, diagnostics, repair and cleanup.
              </p>
            </div>
            <div className="screenshotGrid">
              {screenshots.map((shot) => (
                <Link className="screenshotCard" key={shot.src} to="/docs/product/screenshots">
                  <img src={shot.src} alt={shot.title} loading="lazy" />
                  <span>{shot.title}</span>
                </Link>
              ))}
            </div>
          </div>
        </section>

        <section className="sectionBlock">
          <div className="container">
            <div className="sectionHeading">
              <p className="eyebrow">Why it exists</p>
              <h2>Python tooling is powerful, but environment maintenance is fragmented.</h2>
              <p>
                VOrchestra does not replace uv, pip, VS Code, Docker, Jupyter, Conda or Pixi. It
                sits above them as the local operations layer: what exists, what is broken, what is
                stale, what is vulnerable, what is wasting disk, and what action should happen next.
              </p>
            </div>
            <FeatureGrid />
          </div>
        </section>

        <section className="sectionBlock">
          <div className="container">
            <div className="calloutPanel">
              <div>
                <p className="eyebrow">Product direction</p>
                <h2>Less generic package UI. More environment maintenance.</h2>
                <p>
                  The highest-value workflows are health score, repair wizard, disk cleanup,
                  project-first mode, uv-native operations and VS Code interpreter diagnostics.
                </p>
              </div>
              <div className="heroActions">
                <Link className="voButton voButtonPrimary" to="/docs/product/health-repair">
                  Open repair docs
                </Link>
                <Link className="voButton voButtonSecondary" to="/docs/product/disk-cleanup">
                  Open cleanup docs
                </Link>
              </div>
            </div>
          </div>
        </section>
      </main>
    </Layout>
  );
}
