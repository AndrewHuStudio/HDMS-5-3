export interface HeightCheckSetbackVolume {
  plot_name: string;
  height_limit: number;
  is_exceeded: boolean;
  points: [number, number, number][];
}
