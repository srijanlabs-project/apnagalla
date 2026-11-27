import { Component, type ReactNode } from 'react';
import { reportCrash } from '../lib/crashReport';
import { t } from '../lib/i18n';

/** A screen that crashes shows a way back instead of a blank page, and the crash is reported. */
export default class CrashBoundary extends Component<{ children: ReactNode }, { failed: boolean }> {
  state = { failed: false };

  static getDerivedStateFromError() {
    return { failed: true };
  }

  componentDidCatch(error: unknown, info: { componentStack?: string | null }) {
    reportCrash(error, (info.componentStack ?? '').trim().split('\n')[0]);
  }

  render() {
    if (!this.state.failed) return this.props.children;
    return (
      <div className="crash-screen">
        <h2>{t('Something went wrong on this screen')}</h2>
        <p>{t('Your data is safe. We have been told about it.')}</p>
        <button type="button" onClick={() => location.assign('/tabs/home')}>
          {t('Go to Home')}
        </button>
      </div>
    );
  }
}
