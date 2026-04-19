#import "AppDelegate.h"
#import "Jarvis-Swift.h"

#import <React/RCTBundleURLProvider.h>

@implementation AppDelegate

- (BOOL)application:(UIApplication *)app openURL:(NSURL *)url options:(NSDictionary<UIApplicationOpenURLOptionsKey,id> *)options {
  if ([url.scheme isEqualToString:@"jarvis"]) {
    [WearablesURLHandler handle:url];
    return YES;
  }
  return [super application:app openURL:url options:options];
}

- (BOOL)application:(UIApplication *)application didFinishLaunchingWithOptions:(NSDictionary *)launchOptions
{
  [WearablesURLHandler configureEarly]; // Ensures Wearables is ready for URL callbacks before JS starts
  self.moduleName = @"Jarvis";
  // You can add your custom initial props in the dictionary below.
  // They will be passed down to the ViewController used by React Native.
  self.initialProps = @{};

  return [super application:application didFinishLaunchingWithOptions:launchOptions];
}

- (NSURL *)sourceURLForBridge:(RCTBridge *)bridge
{
  return [self bundleURL];
}

- (NSURL *)bundleURL
{
  NSURL *embedded = [[NSBundle mainBundle] URLForResource:@"main" withExtension:@"jsbundle"];
#if DEBUG
  // Use Metro if running, otherwise fall back to embedded bundle
  NSURL *metro = [[RCTBundleURLProvider sharedSettings] jsBundleURLForBundleRoot:@"index"];
  return embedded ? embedded : metro;
#else
  return embedded;
#endif
}

@end
