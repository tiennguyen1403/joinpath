import {
  Alert,
  AlertContent,
  AlertDescription,
  AlertIcon,
  AlertTitle,
  type AlertVariant,
} from '@/components/beui/motion/alert';

/** A dialog's destructive button on a tint of red: Delete, Cancel onboarding, Discard draft. */
export const TINTED_DANGER =
  'bg-destructive/10 text-danger-strong hover:bg-destructive/15 active:bg-destructive/20';

/** An alert on a tint of its color, its text in muted grey. */
export function Notice({
  variant,
  title,
  text,
}: {
  variant: AlertVariant;
  title: string;
  text?: string;
}) {
  return (
    <Alert
      variant={variant}
      className={
        {
          default: 'bg-foreground/4',
          success: 'bg-success/7 text-success-strong',
          info: 'bg-primary/7 text-primary-strong',
          warning: 'bg-warning/7 text-warning-strong',
          destructive: 'bg-destructive/7 text-danger-strong',
        }[variant]
      }
    >
      <AlertIcon />
      <AlertContent>
        <AlertTitle>{title}</AlertTitle>
        {text && (
          <AlertDescription className="text-muted-foreground">
            {text}
          </AlertDescription>
        )}
      </AlertContent>
    </Alert>
  );
}
