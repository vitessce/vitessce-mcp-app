/**
 * Example Vitessce view configs backed by public demo data.
 * Adapted from https://github.com/vitessce/vitessce/tree/main/examples/configs
 */

export type VitessceConfig = Record<string, unknown>;

const habib2017: VitessceConfig = {
  version: "1.0.18",
  name: "Habib et al., 2017 Nature Methods",
  description:
    "Archived frozen adult human post-mortem brain tissue profiled by snRNA-seq (DroNc-seq)",
  initStrategy: "auto",
  datasets: [
    {
      uid: "habib-2017",
      name: "Habib 2017",
      files: [
        {
          fileType: "anndata.zarr",
          url: "https://storage.googleapis.com/vitessce-demo-data/habib-2017/habib17.processed.h5ad.zarr",
          coordinationValues: {
            obsType: "cell",
            featureType: "gene",
            featureValueType: "expression",
            embeddingType: "UMAP",
          },
          options: {
            obsFeatureMatrix: {
              path: "X",
              initialFeatureFilterPath: "var/top_highly_variable",
            },
            obsEmbedding: { path: "obsm/X_umap" },
            obsSets: [{ name: "Cell Type", path: "obs/CellType" }],
          },
        },
      ],
    },
  ],
  coordinationSpace: {
    embeddingType: { UMAP: "UMAP" },
    obsType: { A: "cell" },
    featureType: { A: "gene" },
    featureValueType: { A: "expression" },
    featureValueColormapRange: { A: [0.0, 0.35] },
  },
  layout: [
    {
      component: "scatterplot",
      coordinationScopes: {
        embeddingType: "UMAP",
        obsType: "A",
        featureType: "A",
        featureValueType: "A",
        featureValueColormapRange: "A",
      },
      x: 0, y: 0, w: 6, h: 6,
    },
    {
      component: "obsSets",
      coordinationScopes: { obsType: "A" },
      x: 6, y: 0, w: 3, h: 6,
    },
    {
      component: "featureList",
      coordinationScopes: { featureType: "A" },
      x: 9, y: 0, w: 3, h: 6,
    },
    {
      component: "heatmap",
      coordinationScopes: {
        obsType: "A",
        featureType: "A",
        featureValueType: "A",
        featureValueColormapRange: "A",
      },
      props: { transpose: true },
      x: 0, y: 6, w: 9, h: 6,
    },
    {
      component: "obsSetSizes",
      coordinationScopes: { obsType: "A" },
      x: 9, y: 6, w: 3, h: 6,
    },
  ],
};

const rgbChannel = (c: number, color: number[]) => ({
  selection: { c },
  color,
  visible: true,
  slider: [0, 255],
});

const humanLymphNodeVisium: VitessceConfig = {
  version: "1.0.18",
  name: "Human lymph node, 10x Genomics Visium",
  description: "Visium Spatial Gene Expression data from 10x Genomics",
  initStrategy: "auto",
  datasets: [
    {
      uid: "visium",
      files: [
        {
          fileType: "anndata.zarr",
          url: "https://data-1.vitessce.io/0.0.33/main/human-lymph-node-10x-visium/human_lymph_node_10x_visium.h5ad.zarr",
          coordinationValues: {
            obsType: "spot",
            featureType: "gene",
            featureValueType: "expression",
          },
          options: {
            obsFeatureMatrix: {
              path: "obsm/X_hvg",
              featureFilterPath: "var/highly_variable",
            },
            obsLocations: { path: "obsm/spatial" },
            obsSegmentations: { path: "obsm/segmentations" },
            obsEmbedding: [
              { path: "obsm/X_umap", embeddingType: "UMAP" },
              { path: "obsm/X_pca", embeddingType: "PCA" },
            ],
            obsSets: [{ name: "Leiden Cluster", path: "obs/clusters" }],
          },
        },
        {
          fileType: "image.ome-zarr",
          url: "https://vitessce-data.storage.googleapis.com/0.0.33/main/human-lymph-node-10x-visium/human_lymph_node_10x_visium.ome.zarr",
        },
      ],
    },
  ],
  coordinationSpace: {
    obsType: { A: "spot" },
    spatialSegmentationLayer: {
      A: { radius: 65, stroked: true, visible: true, opacity: 1 },
    },
    spatialImageLayer: {
      A: [
        {
          type: "raster",
          index: 0,
          colormap: null,
          transparentColor: null,
          opacity: 1,
          domainType: "Min/Max",
          channels: [
            rgbChannel(0, [255, 0, 0]),
            rgbChannel(1, [0, 255, 0]),
            rgbChannel(2, [0, 0, 255]),
          ],
        },
      ],
    },
    obsColorEncoding: { A: "cellSetSelection", B: "geneSelection" },
    spatialZoom: { A: -2.598 },
    spatialTargetX: { A: 1008.88 },
    spatialTargetY: { A: 1004.69 },
    featureSelection: { A: ["CR2"] },
  },
  layout: [
    {
      component: "spatial",
      coordinationScopes: {
        obsType: "A",
        spatialImageLayer: "A",
        spatialSegmentationLayer: "A",
        spatialZoom: "A",
        spatialTargetX: "A",
        spatialTargetY: "A",
        obsColorEncoding: "A",
      },
      x: 0, y: 0, w: 6, h: 6,
    },
    {
      component: "spatial",
      coordinationScopes: {
        obsType: "A",
        spatialImageLayer: "A",
        spatialSegmentationLayer: "A",
        spatialZoom: "A",
        spatialTargetX: "A",
        spatialTargetY: "A",
        obsColorEncoding: "B",
        featureSelection: "A",
      },
      x: 6, y: 0, w: 6, h: 6,
    },
    {
      component: "layerController",
      coordinationScopes: {
        obsType: "A",
        spatialImageLayer: "A",
        spatialSegmentationLayer: "A",
      },
      props: { disableChannelsIfRgbDetected: true },
      x: 0, y: 6, w: 3, h: 6,
    },
    {
      component: "obsSets",
      coordinationScopes: { obsType: "A", obsColorEncoding: "A" },
      x: 3, y: 6, w: 3, h: 6,
    },
    {
      component: "featureList",
      coordinationScopes: {
        obsType: "A",
        obsColorEncoding: "B",
        featureSelection: "A",
      },
      x: 6, y: 6, w: 3, h: 6,
    },
    {
      component: "heatmap",
      coordinationScopes: { obsType: "A", obsColorEncoding: "A" },
      props: { transpose: true },
      x: 9, y: 6, w: 3, h: 6,
    },
  ],
};

export const EXAMPLES = {
  "habib-2017-snrnaseq": habib2017,
  "human-lymph-node-visium": humanLymphNodeVisium,
} satisfies Record<string, VitessceConfig>;

export type ExampleId = keyof typeof EXAMPLES;

export const EXAMPLE_IDS = Object.keys(EXAMPLES) as [ExampleId, ...ExampleId[]];
