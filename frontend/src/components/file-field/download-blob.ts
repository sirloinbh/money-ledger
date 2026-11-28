// Managed file. Edit it in sirloinbh/project-standards templates/ui/frontend/src/components/file-field/
// Saves data as a file through the browser's download, with a fixed name and type (for example a JSON backup).
// The temporary address is released right after the click.
export function downloadBlob(name: string, type: string, data: BlobPart): void {
  const url = URL.createObjectURL(new Blob([data], { type }));
  const link = document.createElement('a');
  link.href = url;
  link.download = name;
  document.body.append(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
}
