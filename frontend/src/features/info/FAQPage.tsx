import faqContent from '../../assets/content/faq.md?raw'
import { MarkdownPage } from './MarkdownPage'

interface FAQPageProps {
  onBack: () => void
}

export function FAQPage({ onBack }: FAQPageProps) {
  return (
    <MarkdownPage
      title="Frequently Asked Questions"
      content={faqContent}
      onBack={onBack}
    />
  )
}

// To update FAQ content, edit: frontend/src/assets/content/faq.md
