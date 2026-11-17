import { zodResolver } from '@hookform/resolvers/zod';
import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { useNavigate } from 'react-router';
import { Dialog, DialogContent, DialogDescription, DialogTitle } from '@/components/ui/dialog';
import { applyProblem } from '@/lib/forms';
import { useCreateWorkspace } from '@/lib/queries/workspaces';
import { workspaceSchema, type WorkspaceValues } from '@/lib/schemas';
import { slugify } from '@/lib/slug';
import { Field, FormAlert } from './field';
import { PrimaryButton } from './primary-button';

export function CreateWorkspaceDialog({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const navigate = useNavigate();
  const create = useCreateWorkspace();
  const [alert, setAlert] = useState<string | null>(null);
  const form = useForm<WorkspaceValues>({
    resolver: zodResolver(workspaceSchema),
    defaultValues: { name: '', slug: '' },
  });
  const { errors, isSubmitting, dirtyFields } = form.formState;

  const onSubmit = form.handleSubmit(async (values) => {
    setAlert(null);
    try {
      const workspace = await create.mutateAsync(values);
      onOpenChange(false);
      void navigate(`/w/${workspace.id}`);
    } catch (err) {
      setAlert(applyProblem(err, ['name', 'slug'], form.setError));
    }
  });

  const name = form.register('name', {
    // Suggest a slug from the name until the user edits the slug themselves.
    onChange: (e: { target: { value: string } }) => {
      if (!dirtyFields.slug) form.setValue('slug', slugify(e.target.value));
    },
  });

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="gap-5 rounded-3xl border border-white/10 p-7 sm:max-w-md">
        <DialogTitle className="font-display text-2xl">Create a world</DialogTitle>
        <DialogDescription>
          A workspace holds your team, its projects and their boards.
        </DialogDescription>
        <form onSubmit={onSubmit} noValidate className="flex flex-col gap-4">
          <Field id="ws-name" label="Name" error={errors.name?.message} {...name} />
          <Field
            id="ws-slug"
            label="Slug"
            className="font-mono"
            error={errors.slug?.message}
            {...form.register('slug')}
          />
          <FormAlert message={alert} />
          <PrimaryButton type="submit" disabled={isSubmitting}>
            {isSubmitting ? 'Creating…' : 'Create workspace'}
          </PrimaryButton>
        </form>
      </DialogContent>
    </Dialog>
  );
}
