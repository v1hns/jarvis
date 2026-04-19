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
  [WearablesURLHandler configureEarly];
  self.moduleName = @"Jarvis";
  self.initialProps = @{};
  return [super application:application didFinishLaunchingWithOptions:launchOptions];
}

- (NSURL *)sourceURLForBridge:(RCTBridge *)bridge
{
  return [self bundleURL];
}

- (NSURL *)bundleURL
{
  NSString *path = [[NSBundle mainBundle] pathForResource:@"main" ofType:@"jsbundle"];
  if (path) return [NSURL fileURLWithPath:path];
  return [[RCTBundleURLProvider sharedSettings] jsBundleURLForBundleRoot:@"index"];
}

@end
