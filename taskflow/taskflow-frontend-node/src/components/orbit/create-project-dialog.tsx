import { zodResolver } from '@hookform/resolvers/zod';
import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { useNavigate } from 'react-router';
import { Dialog, DialogContent, DialogDescription, DialogTitle } from '@/components/ui/dialog';
import { applyProblem } from '@/lib/forms';
import { useCreateProject } from '@/lib/queries/workspaces';
import { projectSchema, type ProjectValues } from '@/lib/schemas';
import { suggestProjectKey } from '@/lib/slug';
import { Field, FormAlert } from './field';
import { PrimaryButton } from './primary-button';

interface Props {
  workspaceId: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function CreateProjectDialog({ workspaceId, open, onOpenChange }: Props) {
  const navigate = useNavigate();
  const create = useCreateProject(workspaceId);
  const [alert, setAlert] = useState<string | null>(null);
  const form = useForm<ProjectValues>({
    resolver: zodResolver(projectSchema),
    defaultValues: { name: '', key: '', description: '' },
  });
  const { errors, isSubmitting, dirtyFields } = form.formState;

  const onSubmit = form.handleSubmit(async ({ description, ...values }) => {
    setAlert(null);
    try {
      const project = await create.mutateAsync({
        ...values,
        description: description.trim() || null,
      });
      onOpenChange(false);
      void navigate(`/w/${workspaceId}/p/${project.id}`);
    } catch (err) {
      setAlert(applyProblem(err, ['name', 'key', 'description'], form.setError));
    }
  });

  const name = form.register('name', {
    onChange: (e: { target: { value: string } }) => {
      if (!dirtyFields.key) form.setValue('key', suggestProjectKey(e.target.value));
    },
  });

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="gap-5 rounded-3xl border border-white/10 p-7 sm:max-w-md">
        <DialogTitle className="font-display text-2xl">New project</DialogTitle>
        <DialogDescription>Starts with To Do, In Progress and Done columns.</DialogDescription>
        <form onSubmit={onSubmit} noValidate className="flex flex-col gap-4">
          <Field id="p-name" label="Name" error={errors.name?.message} {...name} />
          <Field
            id="p-key"
            label="Key (prefix for task ids, can’t change later)"
            className="font-mono uppercase"
            error={errors.key?.message}
            {...form.register('key', { setValueAs: (v: string) => v.toUpperCase() })}
          />
          <Field
            id="p-desc"
            label="Description (optional)"
            error={errors.description?.message}
            {...form.register('description')}
          />
          <FormAlert message={alert} />
          <PrimaryButton type="submit" disabled={isSubmitting}>
            {isSubmitting ? 'Creating…' : 'Create project'}
          </PrimaryButton>
        </form>
      </DialogContent>
    </Dialog>
  );
}
