import privacyContent from '../../assets/content/privacy-policy.md?raw'
import { MarkdownPage } from './MarkdownPage'

// To update Privacy Policy content, edit: frontend/src/assets/content/privacy-policy.md

interface PrivacyPolicyPageProps {
  onBack: () => void
}

export function PrivacyPolicyPage({ onBack }: PrivacyPolicyPageProps) {
  return (
    <MarkdownPage
      title="Privacy Policy"
      subtitle="Effective as of launch · Last updated March 2026"
      content={privacyContent}
      onBack={onBack}
    />
  )
}

