export interface Story {
  id: string;
  group: string;
  title: string;
  render: () => string;
}
