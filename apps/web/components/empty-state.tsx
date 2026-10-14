import {
  Card,
  CardDescription,
  CardTitle,
} from '@/components/beui/motion/card';

export function EmptyState({
  title,
  description,
}: {
  title: string;
  description: string;
}) {
  return (
    <Card variant="muted" className="items-center gap-2 px-6 py-12 text-center">
      <CardTitle as="h2">{title}</CardTitle>
      <CardDescription className="max-w-sm">{description}</CardDescription>
    </Card>
  );
}
